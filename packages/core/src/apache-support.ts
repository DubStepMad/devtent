import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./config.js";

/** Windows httpd resolves relative -f against its binary directory unless -d sets ServerRoot. */
export const APACHE_PROCFILE_COMMAND =
  "bin/apache/bin/httpd.exe -d . -f etc/apache/httpd.conf";

export function needsApacheProcfileRepair(command: string): boolean {
  if (command.includes("-d bin/apache") || command.includes("-d bin\\apache")) return true;
  if (!command.includes("-f etc/apache/httpd.conf")) return true;
  if (!/\s-d\s+(\.|"\.")(\s|$)/.test(command)) return true;
  return false;
}

const CONFIG_MARKER = "# DevTent apache config v3";

/** Windows php-cgi needs GENERIC backend + explicit SCRIPT_FILENAME (drive letters break ProxyPassMatch). */
export function apachePhpHandlerBlock(): string {
  return `<FilesMatch "\\.php$">
    SetHandler "proxy:fcgi://127.0.0.1:9000/"
    ProxyFCGIBackendType GENERIC
    ProxyFCGISetEnvIf "true" SCRIPT_FILENAME "%{reqenv:DOCUMENT_ROOT}%{reqenv:SCRIPT_NAME}"
  </FilesMatch>`;
}

function apacheHttpdConf(): string {
  return `${CONFIG_MARKER}
# Install root is the working directory; Apache binaries live under bin/apache/

Define APACHE_ROOT "bin/apache"
ServerRoot "."
Listen 80

LoadModule access_compat_module "\${APACHE_ROOT}/modules/mod_access_compat.so"
LoadModule actions_module "\${APACHE_ROOT}/modules/mod_actions.so"
LoadModule alias_module "\${APACHE_ROOT}/modules/mod_alias.so"
LoadModule auth_basic_module "\${APACHE_ROOT}/modules/mod_auth_basic.so"
LoadModule authn_core_module "\${APACHE_ROOT}/modules/mod_authn_core.so"
LoadModule authz_core_module "\${APACHE_ROOT}/modules/mod_authz_core.so"
LoadModule authz_host_module "\${APACHE_ROOT}/modules/mod_authz_host.so"
LoadModule autoindex_module "\${APACHE_ROOT}/modules/mod_autoindex.so"
LoadModule dir_module "\${APACHE_ROOT}/modules/mod_dir.so"
LoadModule env_module "\${APACHE_ROOT}/modules/mod_env.so"
LoadModule log_config_module "\${APACHE_ROOT}/modules/mod_log_config.so"
LoadModule mime_module "\${APACHE_ROOT}/modules/mod_mime.so"
LoadModule proxy_module "\${APACHE_ROOT}/modules/mod_proxy.so"
LoadModule proxy_fcgi_module "\${APACHE_ROOT}/modules/mod_proxy_fcgi.so"
LoadModule rewrite_module "\${APACHE_ROOT}/modules/mod_rewrite.so"
LoadModule setenvif_module "\${APACHE_ROOT}/modules/mod_setenvif.so"

PidFile tmp/apache.pid
ErrorLog logs/apache-error.log
LogLevel warn

<Directory />
  AllowOverride none
  Require all denied
</Directory>

DocumentRoot "www"
<Directory "www">
  Options Indexes FollowSymLinks
  AllowOverride All
  Require all granted
</Directory>

DirectoryIndex index.php index.html
TypesConfig "\${APACHE_ROOT}/conf/mime.types"

Include etc/apache/sites/*.conf
`;
}

async function needsApacheConfigRewrite(confPath: string): Promise<boolean> {
  if (!(await pathExists(confPath))) return true;
  const content = await readFile(confPath, "utf-8");
  if (content.includes(CONFIG_MARKER)) return false;
  return true;
}

/** Write or upgrade etc/apache/httpd.conf for portable layout (install root = ServerRoot). */
export async function ensureApacheConfig(root: string): Promise<void> {
  const etcApache = path.join(root, "etc", "apache");
  const confPath = path.join(etcApache, "httpd.conf");
  await mkdir(path.join(etcApache, "sites"), { recursive: true });
  await mkdir(path.join(root, "tmp"), { recursive: true });

  if (await needsApacheConfigRewrite(confPath)) {
    await writeFile(confPath, apacheHttpdConf(), "utf-8");
  }
}

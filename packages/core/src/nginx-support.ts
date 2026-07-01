import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists, resolvePath } from "./config.js";

const SUPPORT_FILES = ["mime.types", "fastcgi_params"] as const;

/** Nginx default temp dirs (relative to -p prefix) when not overridden in nginx.conf. */
const NGINX_TEMP_DIRS = [
  "temp/client_body_temp",
  "temp/proxy_temp",
  "temp/fastcgi_temp",
  "temp/uwsgi_temp",
  "temp/scgi_temp",
  "tmp/client_body_temp",
  "tmp/proxy_temp",
  "tmp/fastcgi_temp",
  "tmp/uwsgi_temp",
  "tmp/scgi_temp",
] as const;

const BUNDLED_REL_DIRS = ["bin/nginx/conf", "bin/nginx"];

const DEFAULT_MIME_TYPES = `types {
    text/html                             html htm shtml;
    text/css                              css;
    text/xml                              xml;
    image/gif                             gif;
    image/jpeg                            jpeg jpg;
    application/javascript                js;
    application/atom+xml                  atom;
    application/rss+xml                   rss;

    text/mathml                           mml;
    text/plain                            txt;
    text/vnd.sun.j2me.app-descriptor      jad;
    text/vnd.wap.wml                      wml;
    text/x-component                      htc;

    image/avif                            avif;
    image/png                             png;
    image/svg+xml                         svg svgz;
    image/tiff                            tif tiff;
    image/vnd.wap.wbmp                    wbmp;
    image/webp                            webp;
    image/x-icon                          ico;
    image/x-jng                           jng;
    image/x-ms-bmp                        bmp;

    font/woff                             woff;
    font/woff2                            woff2;

    application/java-archive              jar war ear;
    application/json                      json;
    application/mac-binhex40              hqx;
    application/msword                    doc;
    application/pdf                       pdf;
    application/postscript                ps eps ai;
    application/rtf                       rtf;
    application/vnd.apple.mpegurl         m3u8;
    application/vnd.google-earth.kml+xml  kml;
    application/vnd.google-earth.kmz        kmz;
    application/vnd.ms-excel              xls;
    application/vnd.ms-fontobject         eot;
    application/vnd.ms-powerpoint         ppt;
    application/vnd.oasis.opendocument.graphics        odg;
    application/vnd.oasis.opendocument.presentation    odp;
    application/vnd.oasis.opendocument.spreadsheet     ods;
    application/vnd.oasis.opendocument.text            odt;
    application/vnd.openxmlformats-officedocument.presentationml.presentation pptx;
    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet         xlsx;
    application/vnd.openxmlformats-officedocument.wordprocessingml.document   docx;
    application/vnd.wap.wmlc            wmlc;
    application/wasm                      wasm;
    application/x-7z-compressed           7z;
    application/x-cocoa                   cco;
    application/x-java-archive-diff       jardiff;
    application/x-java-jnlp-file           jnlp;
    application/x-makeself                run;
    application/x-perl                    pl pm;
    application/x-pilot                   prc pdb;
    application/x-rar-compressed          rar;
    application/x-redhat-package-manager  rpm;
    application/x-sea                     sea;
    application/x-shockwave-flash         swf;
    application/x-stuffit                 sit;
    application/x-tcl                     tcl tk;
    application/x-x509-ca-cert            der pem crt;
    application/x-xpinstall               xpi;
    application/xhtml+xml                 xhtml;
    application/xspf+xml                  xspf;
    application/zip                       zip;

    application/octet-stream              bin exe dll;
    application/octet-stream              deb;
    application/octet-stream              dmg;
    application/octet-stream              iso img;
    application/octet-stream              msi msp msm;

    audio/midi                            mid midi kar;
    audio/mpeg                            mp3;
    audio/ogg                             ogg;
    audio/x-m4a                           m4a;
    audio/x-realaudio                     ra;

    video/3gpp                            3gpp 3gp;
    video/mp2t                            ts;
    video/mp4                             mp4;
    video/mpeg                            mpeg mpg;
    video/quicktime                       mov;
    video/webm                            webm;
    video/x-flv                           flv;
    video/x-m4v                           m4v;
    video/x-mng                           mng;
    video/x-ms-asf                        asx asf;
    video/x-ms-wmv                        wmv;
    video/x-msvideo                       avi;
}
`;

const DEFAULT_FASTCGI_PARAMS = `fastcgi_param  QUERY_STRING       $query_string;
fastcgi_param  REQUEST_METHOD     $request_method;
fastcgi_param  CONTENT_TYPE       $content_type;
fastcgi_param  CONTENT_LENGTH     $content_length;

fastcgi_param  SCRIPT_NAME        $fastcgi_script_name;
fastcgi_param  REQUEST_URI        $request_uri;
fastcgi_param  DOCUMENT_URI       $document_uri;
fastcgi_param  DOCUMENT_ROOT      $document_root;
fastcgi_param  SERVER_PROTOCOL    $server_protocol;
fastcgi_param  REQUEST_SCHEME     $scheme;
fastcgi_param  HTTPS              $https if_not_empty;

fastcgi_param  GATEWAY_INTERFACE  CGI/1.1;
fastcgi_param  SERVER_SOFTWARE    nginx/$nginx_version;

fastcgi_param  REMOTE_ADDR        $remote_addr;
fastcgi_param  REMOTE_PORT        $remote_port;
fastcgi_param  SERVER_ADDR        $server_addr;
fastcgi_param  SERVER_PORT        $server_port;
fastcgi_param  SERVER_NAME        $server_name;

fastcgi_param  REDIRECT_STATUS    200;
`;

const DEFAULTS: Record<(typeof SUPPORT_FILES)[number], string> = {
  "mime.types": DEFAULT_MIME_TYPES,
  "fastcgi_params": DEFAULT_FASTCGI_PARAMS,
};

/** Create nginx buffer/temp directories under the install prefix (-p .). */
export async function ensureNginxTempDirs(root: string): Promise<void> {
  for (const dir of NGINX_TEMP_DIRS) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
}

/** Copy nginx conf helpers into etc/nginx/ (mime.types, fastcgi_params). */
export async function ensureNginxSupportFiles(root: string): Promise<void> {
  const etcNginx = path.join(root, "etc", "nginx");
  await mkdir(etcNginx, { recursive: true });
  await ensureNginxTempDirs(root);

  for (const file of SUPPORT_FILES) {
    const dest = path.join(etcNginx, file);
    if (await pathExists(dest)) continue;

    let copied = false;
    for (const dir of BUNDLED_REL_DIRS) {
      const src = resolvePath(root, path.join(dir, file));
      if (await pathExists(src)) {
        await copyFile(src, dest);
        copied = true;
        break;
      }
    }

    if (!copied) {
      await writeFile(dest, DEFAULTS[file], "utf-8");
    }
  }
}

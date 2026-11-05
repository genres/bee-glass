#!/usr/bin/env python3
"""Upload dist/bee-dl-extension.zip to addons.mozilla.org (API v5) and download the signed .xpi.

Usage:  tools/amo-sign.py [--channel unlisted|listed] [--manifest M --zip Z --listing L --out DIR] [--selftest]
        (defaults: this repo's bee-dl extension)
Keys:   ~/.config/bee-dl/amo.json  {"issuer": "user:…", "secret": "…"}  (chmod 600; never commit or log)
Output: dist/bee-dl-<version>-signed.xpi
Standard library only. --channel listed = public store submission (goes to Mozilla review).
"""
import base64, hashlib, hmac, json, os, secrets, sys, time, urllib.error, urllib.request, uuid

API = 'https://addons.mozilla.org/api/v5'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYS = os.path.expanduser('~/.config/bee-dl/amo.json')


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def jwt(issuer, secret, now=None):
    now = int(now or time.time())
    head = b64(json.dumps({'alg': 'HS256', 'typ': 'JWT'}, separators=(',', ':')).encode())
    body = b64(json.dumps({'iss': issuer, 'jti': secrets.token_hex(16), 'iat': now, 'exp': now + 60}, separators=(',', ':')).encode())
    sig = b64(hmac.new(secret.encode(), f'{head}.{body}'.encode(), hashlib.sha256).digest())
    return f'{head}.{body}.{sig}'


def call(keys, method, path, data=None, files=None, raw=False):
    url = path if path.startswith('http') else API + path
    headers = {'Authorization': 'JWT ' + jwt(keys['issuer'], keys['secret'])}
    body = None
    if files:  # multipart/form-data by hand
        boundary = uuid.uuid4().hex
        parts = []
        for k, v in (data or {}).items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        for k, (name, content) in files.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\n'
                         f'Content-Type: application/zip\r\n\r\n'.encode() + content + b'\r\n')
        body = b''.join(parts) + f'--{boundary}--\r\n'.encode()
        headers['Content-Type'] = f'multipart/form-data; boundary={boundary}'
    elif data is not None:
        body = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            out = r.read()
            return out if raw else json.loads(out or b'{}')
    except urllib.error.HTTPError as e:
        sys.exit(f'AMO {method} {path} → HTTP {e.code}: {e.read().decode(errors="replace")[:800]}')


def main():
    if '--selftest' in sys.argv:
        t = jwt('user:1', 's3cret', now=1000).split('.')
        assert json.loads(base64.urlsafe_b64decode(t[1] + '==')) ['exp'] == 1060
        assert hmac.compare_digest(t[2], b64(hmac.new(b's3cret', f'{t[0]}.{t[1]}'.encode(), hashlib.sha256).digest()))
        print('selftest ok'); return
    channel = sys.argv[sys.argv.index('--channel') + 1] if '--channel' in sys.argv else 'unlisted'
    assert channel in ('unlisted', 'listed')
    if os.stat(KEYS).st_mode & 0o077:
        sys.exit(f'{KEYS} must be private: chmod 600 {KEYS}')
    keys = json.load(open(KEYS))
    arg = lambda name, default: sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
    manifest_path = arg('--manifest', os.path.join(ROOT, 'src/extension/manifest.json'))
    listing_path = arg('--listing', os.path.join(ROOT, 'src/listing.json'))
    out_dir = arg('--out', os.path.join(ROOT, 'dist'))
    license_slug = arg('--license', 'MIT')  # themes use Creative Commons slugs, e.g. cc-by-4.0
    manifest = json.load(open(manifest_path))
    guid, version = manifest['browser_specific_settings']['gecko']['id'], manifest['version']
    zip_path = arg('--zip', os.path.join(ROOT, 'dist/bee-dl-extension.zip'))

    up = call(keys, 'POST', '/addons/upload/', data={'channel': channel},
              files={'upload': (os.path.basename(zip_path), open(zip_path, 'rb').read())})
    print('uploaded', up['uuid'], '— waiting for Mozilla\'s validator…')
    while not up.get('processed'):
        time.sleep(5)
        up = call(keys, 'GET', f'/addons/upload/{up["uuid"]}/')
    msgs = (up.get('validation') or {}).get('messages', [])
    for m in msgs:
        print(f'  [{m.get("type")}] {m.get("message")} ({m.get("file") or ""})')
    if not up.get('valid'):
        sys.exit('validation failed — fix the errors above and rebuild')

    # New add-on on first run, a new version afterwards.
    exists = True
    try:
        urllib.request.urlopen(urllib.request.Request(f'{API}/addons/addon/{guid}/',
                               headers={'Authorization': 'JWT ' + jwt(keys['issuer'], keys['secret'])}), timeout=60)
    except urllib.error.HTTPError as e:
        exists = e.code != 404
    if channel == 'listed':  # store page text/categories from src/listing.json
        listing = json.load(open(listing_path))
        if exists:
            call(keys, 'PATCH', f'/addons/addon/{guid}/', data=listing)
            print('store page text updated')
    if exists:
        ver = call(keys, 'POST', f'/addons/addon/{guid}/versions/', data={'upload': up['uuid'], 'license': license_slug})
    else:
        new = {'version': {'upload': up['uuid'], 'license': license_slug}}
        if channel == 'listed':
            new.update(json.load(open(listing_path)))
        call(keys, 'POST', '/addons/addon/', data=new)
        ver = call(keys, 'GET', f'/addons/addon/{guid}/versions/?filter=all_with_unlisted')['results'][0]
    print('version', ver.get('version'), 'created — waiting for signing…')
    for _ in range(18 if channel == 'listed' else 120):  # listed may sit in Mozilla's review queue
        ver = call(keys, 'GET', f'/addons/addon/{guid}/versions/{ver["id"]}/')
        f = ver.get('file') or {}
        if f.get('status') == 'public' and f.get('url'):
            out = os.path.join(out_dir, f'{guid.split("@")[0]}-{version}-signed.xpi')
            open(out, 'wb').write(call(keys, 'GET', f['url'], raw=True))
            print('signed:', out)
            return
        if f.get('status') in ('disabled',):
            sys.exit(f'Mozilla rejected the file: {json.dumps(ver)[:600]}')
        time.sleep(10)
    if channel == 'listed':
        print('in Mozilla\'s review queue (status:', (ver.get('file') or {}).get('status'), ') — it goes live when approved')
        return
    sys.exit('still not signed after 20 minutes; rerun later or check the Developer Hub')


if __name__ == '__main__':
    main()

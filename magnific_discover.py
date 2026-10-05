"""
magnific_discover.py — curl_cffi sidecar to discover available image/video models
Called by Node.js to pull LIVE /app/api/tti-modes and /app/api/video/ai-models,
so we can detect newly-added or newly-unlimited models.
Usage: python magnific_discover.py <cookie_string>
Prints JSON {images:[...], videos:[...], error:...} to stdout.
"""
import sys, json
from curl_cffi import requests as cffi

BASE = 'https://www.magnific.com'
UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'no cookie string provided'}))
        sys.exit(1)

    cookie_str = sys.argv[1]
    cookies = {}
    for part in cookie_str.split('; '):
        if '=' in part:
            k, _, v = part.partition('=')
            cookies[k.strip()] = v.strip()

    headers = {
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': UA,
    }

    result = {'images': None, 'videos': None, 'error': None}

    # Image models — /app/api/tti-modes
    try:
        r = cffi.get(
            f'{BASE}/app/api/tti-modes',
            headers={**headers, 'referer': f'{BASE}/app/ai-image-generator'},
            cookies=cookies, impersonate='chrome131', timeout=25,
        )
        result['imagesStatus'] = r.status_code
        if r.status_code == 200:
            result['images'] = r.json()
    except Exception as e:
        result['error'] = f'tti-modes failed: {e}'

    # Video models — /app/api/video/ai-models
    try:
        r2 = cffi.get(
            f'{BASE}/app/api/video/ai-models',
            headers={**headers, 'referer': f'{BASE}/app/ai-video-generator'},
            cookies=cookies, impersonate='chrome131', timeout=25,
        )
        result['videosStatus'] = r2.status_code
        if r2.status_code == 200:
            result['videos'] = r2.json()
    except Exception as e:
        result['error'] = (result.get('error') or '') + f' | video/ai-models failed: {e}'

    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()

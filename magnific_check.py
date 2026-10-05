"""
magnific_check.py — curl_cffi sidecar for velox-bridge
Called by Node.js checkAccountPlan() to bypass Cloudflare WAF.
Usage: python magnific_check.py <cookie_string>
Prints JSON to stdout, exits 0 on success, 1 on error.
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
    # Parse cookie string into dict for curl_cffi
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

    result = {'plan': None, 'credits': None, 'walletId': None, 'email': None, 'error': None}

    # Step 1: auth/verify — get walletId, email, freepikPremium
    try:
        r = cffi.get(
            f'{BASE}/app/api/auth/verify',
            headers={**headers, 'referer': f'{BASE}/app/ai-image-generator'},
            cookies=cookies,
            impersonate='chrome131',
            timeout=20,
        )
        if r.status_code == 200:
            data = r.json()
            ud = data.get('userData', {})
            result['email']    = ud.get('email')
            result['walletId'] = ud.get('walletId')
            result['freepikPremium'] = ud.get('freepikPremium', False)
        else:
            result['authStatus'] = r.status_code
    except Exception as e:
        result['error'] = f'auth/verify failed: {e}'

    # Step 2: my-subscriptions — get plan, isFree, purchases
    try:
        r2 = cffi.get(
            f'{BASE}/user/api/my-subscriptions',
            headers={**headers, 'referer': f'{BASE}/user/my-subscriptions'},
            cookies=cookies,
            impersonate='chrome131',
            timeout=20,
        )
        result['subsStatus'] = r2.status_code
        if r2.status_code == 200:
            subs = r2.json()
            perms     = subs.get('permissions', {})
            purchases = subs.get('purchases', [])
            result['isFree']    = perms.get('isFree', True)
            result['purchases'] = purchases

            if perms.get('isFree'):
                result['plan'] = 'free'
            elif purchases:
                last = purchases[-1]
                purchase_status = (last.get('purchaseStatus') or '').lower()
                product = last.get('purchaseProduct') or {}
                result['planName']      = product.get('productName') or last.get('name')
                result['expiresAt']     = last.get('purchaseNextBillingDate') or last.get('expiresAt')
                result['purchaseStatus'] = purchase_status

                ACTIVE_STATUSES = {'active', 'trialing', 'past_due', 'non_renewed'}
                if purchase_status == 'unpaid':
                    result['plan'] = 'unpaid'
                elif purchase_status in ACTIVE_STATUSES:
                    result['plan'] = 'premium'
                else:
                    result['plan'] = 'expired'
            else:
                result['plan'] = 'free'
        elif r2.status_code in (401, 403):
            result['plan'] = 'expired'
        elif r2.status_code == 204:
            result['plan'] = 'free'
    except Exception as e:
        result['error'] = (result.get('error') or '') + f' | subs failed: {e}'

    # Step 3: wallet credits — only if we have a walletId and plan is premium
    if result.get('walletId') and result.get('plan') == 'premium':
        try:
            wallet_url = f'{BASE}/app/api/wallet?wallet_id={result["walletId"]}&lang=en_US'
            r3 = cffi.get(
                wallet_url,
                headers={**headers, 'referer': f'{BASE}/app/ai-image-generator'},
                cookies=cookies,
                impersonate='chrome131',
                timeout=20,
            )
            if r3.status_code == 200:
                w = r3.json()
                result['credits']      = w.get('credits')
                result['totalCredits'] = w.get('totalCredits')
                result['creditsSpend'] = w.get('creditsSpend')
                result['productName']  = w.get('productName') or result.get('planName')
        except Exception as e:
            result['walletError'] = str(e)

    print(json.dumps(result))
    sys.exit(0)

if __name__ == '__main__':
    main()

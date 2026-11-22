"""가계부 리포트 웹 푸시 보내기 (GitHub Actions에서 실행).

구독한 기기 목록은 Firebase Realtime Database의 rooms/<방>/push 에 앱이 저장해 둔다.
보안 규칙상 방 ID를 아는 쪽만 읽고 쓸 수 있으므로, 방 ID와 VAPID 비밀 키는 GitHub Secrets에 둔다.
  - VAPID_PRIVATE_KEY : openssl로 만든 PEM 전체
  - PUSH_ROOM_ID      : 가족 공유 방 ID
같은 달에 두 번 보내지 않도록 rooms/<방>/pushLog/report 에 보낸 달(YYYY-MM)을 적는다.
"""
import datetime
import json
import os
import re
import sys
import tempfile
import urllib.request

from pywebpush import WebPushException, webpush

KST = datetime.timezone(datetime.timedelta(hours=9))
# VAPID 'sub'는 mailto: 또는 경로 없는 https://호스트 형식만 받는다
VAPID_SUB = 'https://kkkkkijun.github.io'


def db_url():
    with open('firebase-config.js', encoding='utf-8') as f:
        m = re.search(r'databaseURL:\s*"([^"]+)"', f.read())
    if not m:
        sys.exit('firebase-config.js에서 databaseURL을 찾지 못했어요')
    return m.group(1).rstrip('/')


def call(method, url, body=None):
    data = None if body is None else json.dumps(body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read()
    return json.loads(raw) if raw else None


def main():
    room = os.environ.get('PUSH_ROOM_ID', '').strip()
    key = os.environ.get('VAPID_PRIVATE_KEY', '').strip()
    test = os.environ.get('PUSH_TEST') == '1'
    if not re.fullmatch(r'[a-z0-9]{20,40}', room):
        sys.exit('PUSH_ROOM_ID 시크릿이 없거나 형식이 달라요 (가족 공유 방 ID)')
    if 'PRIVATE KEY' not in key:
        sys.exit('VAPID_PRIVATE_KEY 시크릿이 없거나 PEM 형식이 아니에요')

    base = f'{db_url()}/rooms/{room}'
    now = datetime.datetime.now(KST)
    prev = now.replace(day=1) - datetime.timedelta(days=1)
    ym = prev.strftime('%Y-%m')

    if not test and call('GET', f'{base}/pushLog/report.json') == ym:
        print(f'{ym} 리포트 알림은 이미 보냈어요. 건너뜀')
        return

    subs = call('GET', f'{base}/push.json') or {}
    if not subs:
        print('알림을 켠 기기가 없어요. 앱 › 가계부 › 리포트에서 "이 폰에서 알림 켜기"를 눌러 주세요')
        return

    if test:
        body = '테스트 알림이에요. 매달 1일 오전 9시에 이렇게 와요.'
    else:
        body = f'{prev.month}월 가계부 리포트가 완성됐어요. 눌러서 확인해 보세요.'
    payload = json.dumps({'title': 'luckybbu 가계부', 'body': body, 'url': './?open=report', 'tag': f'report-{ym}'}, ensure_ascii=False)

    with tempfile.NamedTemporaryFile('w', suffix='.pem', delete=False) as f:
        f.write(key + '\n')
        key_path = f.name
    os.chmod(key_path, 0o600)

    sent = 0
    try:
        for sid, s in subs.items():
            if not isinstance(s, dict) or not s.get('endpoint'):
                continue
            info = {'endpoint': s['endpoint'], 'keys': s.get('keys') or {}}
            try:
                # 클레임은 기기마다 새로 만든다 (보내는 곳마다 aud가 다름)
                webpush(subscription_info=info, data=payload, vapid_private_key=key_path,
                        vapid_claims={'sub': VAPID_SUB}, ttl=86400, timeout=20)
                sent += 1
                print(f'보냄: {s.get("who") or sid}')
            except WebPushException as e:
                code = getattr(e.response, 'status_code', None)
                if code in (404, 410):
                    call('DELETE', f'{base}/push/{sid}.json')
                    print(f'만료된 기기 정리: {s.get("who") or sid}')
                else:
                    print(f'보내기 실패 ({code}): {s.get("who") or sid}')
    finally:
        os.remove(key_path)

    if sent and not test:
        call('PUT', f'{base}/pushLog/report.json', ym)
    print(f'완료: {sent}/{len(subs)}대')
    if not sent:
        sys.exit(1)


if __name__ == '__main__':
    main()

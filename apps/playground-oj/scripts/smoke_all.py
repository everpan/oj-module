#!/usr/bin/env python3
"""playground-oj 集成冒烟：给定 ram 服务基址（如 http://127.0.0.1:4173），
对全部模块端点做端到端校验。dev / preview 两态共用此脚本。
返回非 0 即失败（供 smoke.sh 判定）。
"""
import json
import sys
import urllib.request
import urllib.error

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173").rstrip("/")
API = BASE + "/api"

passed = 0
failed = 0


def log(ok, name, extra=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"[PASS] {name} {extra}")
    else:
        failed += 1
        print(f"[FAIL] {name} {extra}")


def req(method, path, token=None, data=None, raw=None, ctype=None, expect=200):
    url = API + path
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = None
    if raw is not None:
        body = raw
        if ctype:
            headers["Content-Type"] = ctype
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def data_of(status, body, expect=200):
    if status != expect:
        return None, f"status={status} (expect {expect})"
    try:
        return json.loads(body).get("data"), ""
    except Exception as e:  # noqa
        return None, f"bad json: {e}"


# 1) 登录拿 token
s, b = req("POST", "/auth/login", data={"username": "admin", "password": "12345"})
d, err = data_of(s, b)
if d is None or not d.get("access_token"):
    log(False, "auth/login", err or "no token")
    token = None
else:
    token = d["access_token"]
    log(True, "auth/login", f"user={d.get('username')} roles={d.get('roles')}")

# 无 token 时后续跳过
if not token:
    print(f"\n{failed} failed, {passed} passed")
    sys.exit(1)

# 2) home/pie
s, b = req("GET", "/home/pie", token=token)
d, err = data_of(s, b)
log(d is not None and len(d) == 5, "home/pie", f"cats={[x['code'] for x in d] if d else err}")

# 3) home/line week
s, b = req("POST", "/home/line", token=token, data={"range": "week"})
d, err = data_of(s, b)
log(d is not None and len(d) == 7, "home/line week", f"len={len(d) if d else err} series={d}")

# 4) notification
s, b = req("GET", "/notification/notifications", token=token)
d, err = data_of(s, b)
log(d is not None and len(d) == 4, "notification", f"total={len(d) if d else err} isRead={[x['isRead'] for x in d] if d else ''}")

# 5) demo/todos（GET）
s, b = req("GET", "/demo/todos", token=token)
d, err = data_of(s, b)
log(d is not None and d.get("total") == 4, "demo/todos", f"total={d.get('total') if d else err}")

# 6) system/role-list（GET）
s, b = req("GET", "/system/role-list?current=1&pageSize=10", token=token)
d, err = data_of(s, b)
names = [r["name"] for r in d["list"]] if d and d.get("list") else []
log("admin" in names, "system/role-list", f"names={names}")

# 7) system/menu-list（GET）
s, b = req("GET", "/system/menu-list", token=token)
d, err = data_of(s, b)
ok_menu = False
if d and d.get("list"):
    m = d["list"][0]
    ok_menu = isinstance(m.get("menuType"), int) and isinstance(m.get("parentId"), str)
log(ok_menu, "system/menu-list", f"menuType={d['list'][0].get('menuType') if d and d.get('list') else err} parentId type={type(d['list'][0].get('parentId')).__name__ if d and d.get('list') else ''}")

# 8) web/get-async-routes（跨模块读 system 表，P5 修复点）
s, b = req("GET", "/web/get-async-routes", token=token)
d, err = data_of(s, b)
paths = [n.get("path") for n in d] if isinstance(d, list) else []
log("/home" in paths and "/system" in paths, "web/get-async-routes", f"paths={paths}")

# 9) personal-center/upload（multipart → base64）
png = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] + [0] * 40)
boundary = "----cbtest"
body = (b"--" + boundary.encode() + b"\r\n"
        b'Content-Disposition: form-data; name="file"; filename="a.png"\r\n'
        b"Content-Type: image/png\r\n\r\n" + png + b"\r\n--" + boundary.encode() + b"--\r\n")
s, b = req("POST", "/personal-center/upload", token=token, raw=body,
           ctype="multipart/form-data; boundary=" + boundary)
d, err = data_of(s, b)
log(d is not None and str(d).startswith("data:image/png;base64,"), "personal-center/upload",
    f"prefix={str(d)[:30] if d else err}")

# 10) 无 Bearer 守卫：所有受保护端点应 401
guard_paths = [
    ("GET", "/home/pie"),
    ("POST", "/home/line"),
    ("GET", "/notification/notifications"),
    ("GET", "/demo/todos"),
    ("GET", "/system/role-list"),
    ("GET", "/system/menu-list"),
    ("GET", "/web/get-async-routes"),
    ("POST", "/personal-center/upload"),
]
guard_ok = True
guard_detail = ""
for m, p in guard_paths:
    s, b = req(m, p)
    if s != 401:
        guard_ok = False
        guard_detail = f"{m} {p} -> {s} (expect 401)"
        break
log(guard_ok, "no-bearer guards (8 endpoints)", guard_detail)

print(f"\n{failed} failed, {passed} passed")
sys.exit(1 if failed else 0)

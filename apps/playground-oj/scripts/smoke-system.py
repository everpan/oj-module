import json
import urllib.request

BASE = "http://127.0.0.1:9779/api"


def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw


def login(username, password):
    st, env = req("POST", "/auth/login", body={"username": username, "password": password})
    assert st == 200 and env.get("code") == 0, f"login failed {st} {env}"
    return env["data"]["access_token"]


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    assert cond, name


# 1) login
tok = login("admin", "12345")
print("== role-list ==")
st, env = req("GET", "/system/role-list?current=1&pageSize=10", tok)
check("role-list 200", st == 200 and env.get("code") == 0, str(env)[:120])
roles = env["data"]["list"]
check("role-list has admin", any(r["code"] == "admin" for r in roles), f"total={env['data']['total']}")

print("== menu-list (menu_type present) ==")
st, env = req("GET", "/system/menu-list", tok)
check("menu-list 200", st == 200 and env.get("code") == 0)
menus = env["data"]["list"]
check("menu-list menu_type int", all("menuType" in m and isinstance(m["menuType"], int) for m in menus),
      f"sample={menus[0] if menus else None}")
check("menu-list parentId str", all(isinstance(m["parentId"], str) for m in menus))

print("== role-menu (flat full fields) ==")
st, env = req("GET", "/system/role-menu", tok)
check("role-menu 200", st == 200 and env.get("code") == 0)
check("role-menu has permission field", all("permission" in m for m in env["data"]))

print("== add role ==")
st, env = req("POST", "/system/role-item", tok,
              {"name": "smoke_role", "code": "smoke", "status": 1, "remark": "x", "menus": [100, 104]})
check("add role 200", st == 200 and env.get("code") == 0, str(env)[:120])
new_role_id = env["data"]["id"]
check("add role id>0", new_role_id > 0, f"id={new_role_id}")

print("== role_menu bound (smoke code -> 100,104) ==")
st, env = req("GET", f"/system/menu-by-role-id?id={new_role_id}", tok)
check("menu-by-role-id 200", st == 200 and env.get("code") == 0)
check("bind 100&104", set(env["data"]) >= {100, 104}, str(env["data"]))

print("== update role (rebind to 104 only) ==")
st, env = req("PUT", "/system/role-item", tok,
              {"id": new_role_id, "name": "smoke_role2", "code": "smoke", "status": 0, "remark": "y", "menus": [104]})
check("update role 200", st == 200 and env.get("code") == 0)
st, env = req("GET", f"/system/menu-by-role-id?id={new_role_id}", tok)
check("rebind 104 only", env["data"] == [104], str(env["data"]))

print("== add menu ==")
st, env = req("POST", "/system/menu-item", tok,
              {"parentId": "101", "name": "smoke_menu", "path": "/system/smoke", "component": "/system/smoke/index",
               "menuType": 0, "icon": "AppstoreOutlined", "order": 9, "permission": "", "status": 1})
check("add menu 200", st == 200 and env.get("code") == 0, str(env)[:120])
new_menu_id = int(env["data"])
check("add menu id>0", new_menu_id > 0)

print("== get-async-routes (menu_type path works) ==")
st, env = req("GET", "/web/get-async-routes", tok)
check("async-routes 200", st == 200 and env.get("code") == 0, f"paths={[n['path'] for n in env['data']]}")
check("async-routes has /system", any(n["path"] == "/system" for n in env["data"]))

print("== delete menu ==")
st, env = req("DELETE", "/system/menu-item", tok, new_menu_id)
check("delete menu 200", st == 200 and env.get("code") == 0)

print("== delete role ==")
st, env = req("DELETE", "/system/role-item", tok, new_role_id)
check("delete role 200", st == 200 and env.get("code") == 0)

print("== verify deleted ==")
st, env = req("GET", f"/system/menu-by-role-id?id={new_role_id}", tok)
check("role gone (empty)", env["data"] == [], str(env["data"]))

print("\nALL SYSTEM CRUD CHECKS PASSED")

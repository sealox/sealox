#!/usr/bin/env python3
"""Sealos Cloud API helper: auth, template deploys, store queries.

Standard library only. Credentials live in ~/.sealos/:
  kubeconfig   kubectl-compatible credentials for the current workspace
  auth.json    region + tokens (written by `login`, needed only for login/switch)

The kubeconfig alone is enough for every non-login command, so users can also
paste a kubeconfig from the Sealos web console instead of running `login`.

Commands:
  status                         auth + region + namespace summary
  login [--region URL]           OAuth2 device-flow login, saves kubeconfig
  workspaces                     list workspaces of the signed-in account
  switch <workspace>             switch workspace, refresh kubeconfig
  deploy <template.yaml> [...]   deploy a local template YAML
  deploy-store <template> [...]  deploy a template-store template by name
  store-list [--search Q]        list template-store templates
  store-get <template> [--yaml]  template inputs/quota (and source YAML)
  instances                      list deployed template instances
  delete <instance>              delete an instance and all its resources
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CLIENT_ID = "af993c98-d19d-4bdc-b338-79b80dc4f8bf"
DEFAULT_REGION = "https://usw-1.sealos.io"
KNOWN_REGIONS = [
    "https://usw-1.sealos.io",
    "https://gzg.sealos.run",
    "https://bja.sealos.run",
    "https://hzh.sealos.run",
]

SEALOS_DIR = os.path.expanduser("~/.sealos")
AUTH_PATH = os.path.join(SEALOS_DIR, "auth.json")
KUBECONFIG_PATH = os.environ.get(
    "SEALOS_KUBECONFIG", os.path.join(SEALOS_DIR, "kubeconfig")
)


def fail(message, **extra):
    print(json.dumps({"error": message, **extra}), file=sys.stderr)
    sys.exit(1)


def http_json(url, method="GET", headers=None, data=None, form=None, timeout=30):
    """Make an HTTP request; return (status, parsed-json-or-text)."""
    body = None
    headers = dict(headers or {})
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    elif data is not None:
        body = json.dumps(data).encode()
        headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode()
            status = resp.status
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        status = e.code
    except (urllib.error.URLError, TimeoutError) as e:
        fail(f"request to {url} failed: {e}")
    try:
        return status, json.loads(text)
    except ValueError:
        return status, text


def load_auth():
    if not os.path.exists(AUTH_PATH):
        return {}
    try:
        with open(AUTH_PATH) as f:
            return json.load(f)
    except ValueError:
        return {}


def load_kubeconfig():
    if not os.path.exists(KUBECONFIG_PATH):
        fail(
            "kubeconfig not found; run `sealos-api.py login` or save one from the Sealos web console",
            path=KUBECONFIG_PATH,
        )
    with open(KUBECONFIG_PATH) as f:
        return f.read()


def kubeconfig_field(kubeconfig, field):
    m = re.search(rf"^\s*{field}:\s*[\"']?([^\"'\s]+)", kubeconfig, re.MULTILINE)
    return m.group(1) if m else None


def region_domain():
    """Region domain (e.g. usw-1.sealos.io), from auth.json or the kubeconfig server."""
    auth = load_auth()
    if auth.get("region"):
        return urllib.parse.urlparse(auth["region"]).netloc
    server = kubeconfig_field(load_kubeconfig(), "server")
    if not server:
        fail("cannot determine region: no auth.json region and no server in kubeconfig")
    return urllib.parse.urlparse(server).hostname


def save_credentials(region, access_token, regional_token, kubeconfig, workspace):
    os.makedirs(SEALOS_DIR, exist_ok=True)
    with open(KUBECONFIG_PATH, "w") as f:
        f.write(kubeconfig)
    os.chmod(KUBECONFIG_PATH, 0o600)
    auth = {
        "region": region,
        "access_token": access_token,
        "regional_token": regional_token,
        "authenticated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "auth_method": "oauth2_device_grant",
    }
    if workspace:
        auth["current_workspace"] = workspace
    with open(AUTH_PATH, "w") as f:
        json.dump(auth, f, indent=2)
    os.chmod(AUTH_PATH, 0o600)


# ── commands ─────────────────────────────────────────────


def cmd_status(_args):
    out = {"authenticated": False}
    if os.path.exists(KUBECONFIG_PATH):
        kc = open(KUBECONFIG_PATH).read()
        namespace = kubeconfig_field(kc, "namespace")
        server = kubeconfig_field(kc, "server")
        if server and ("token:" in kc or "client-certificate" in kc):
            auth = load_auth()
            out = {
                "authenticated": True,
                "kubeconfig": KUBECONFIG_PATH,
                "server": server,
                "namespace": namespace,
                "region_domain": urllib.parse.urlparse(server).hostname,
                "workspace": (auth.get("current_workspace") or {}).get("id"),
                "authenticated_at": auth.get("authenticated_at"),
            }
    print(json.dumps(out, indent=2))


def cmd_login(args):
    region = (args.region or os.environ.get("SEALOS_REGION") or DEFAULT_REGION).rstrip("/")

    status, device = http_json(
        f"{region}/api/auth/oauth2/device",
        method="POST",
        form={
            "client_id": CLIENT_ID,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        },
    )
    if status != 200 or not isinstance(device, dict):
        fail(f"device authorization request failed ({status})", response=str(device)[:500])

    url = device.get("verification_uri_complete") or device.get("verification_uri")
    expires_in = int(device.get("expires_in", 600))
    interval = int(device.get("interval", 5))

    # Print the sign-in link immediately: the agent must relay it to the user
    # before this process finishes polling.
    print(
        f"\nOpen this URL in your browser to authorize (expires in {expires_in // 60} min):"
        f"\n\n  {url}\n\nUser code: {device.get('user_code')}\n\nWaiting for authorization...",
        file=sys.stderr,
        flush=True,
    )
    try:
        import webbrowser

        webbrowser.open(url)
    except Exception:
        pass

    deadline = time.time() + min(expires_in, 600)
    token = None
    while time.time() < deadline:
        time.sleep(interval)
        status, resp = http_json(
            f"{region}/api/auth/oauth2/token",
            method="POST",
            form={
                "client_id": CLIENT_ID,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": device.get("device_code"),
            },
        )
        if status == 200 and isinstance(resp, dict) and resp.get("access_token"):
            token = resp["access_token"]
            break
        err = resp.get("error") if isinstance(resp, dict) else None
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            interval += 5
            continue
        if err == "access_denied":
            fail("authorization denied by user")
        if err == "expired_token":
            fail("device code expired; run login again")
        fail(f"token request failed ({status})", response=str(resp)[:500])
    if not token:
        fail("authorization timed out; run login again")

    status, region_data = http_json(
        f"{region}/api/auth/regionToken", method="POST", headers={"Authorization": token}
    )
    data = region_data.get("data") if isinstance(region_data, dict) else None
    if status != 200 or not data or not data.get("token") or not data.get("kubeconfig"):
        fail(f"region token exchange failed ({status})", response=str(region_data)[:500])

    workspace = None
    status, ns_data = http_json(
        f"{region}/api/auth/namespace/list", headers={"Authorization": data["token"]}
    )
    if status == 200 and isinstance(ns_data, dict):
        namespaces = ns_data.get("data") or []
        if isinstance(namespaces, dict):
            namespaces = namespaces.get("namespaces") or []
        private = [ns for ns in namespaces if ns.get("nstype") == "private"]
        chosen = (private or namespaces or [None])[0]
        if chosen:
            workspace = {
                "uid": chosen.get("uid"),
                "id": chosen.get("id"),
                "teamName": chosen.get("teamName"),
            }

    save_credentials(region, token, data["token"], data["kubeconfig"], workspace)
    print(
        json.dumps(
            {
                "authenticated": True,
                "region": region,
                "workspace": (workspace or {}).get("id"),
                "kubeconfig": KUBECONFIG_PATH,
            },
            indent=2,
        )
    )


def regional_token_or_fail():
    auth = load_auth()
    if not auth.get("regional_token"):
        fail("no regional token; run `sealos-api.py login` first")
    return auth


def cmd_workspaces(_args):
    auth = regional_token_or_fail()
    status, ns_data = http_json(
        f"{auth['region']}/api/auth/namespace/list",
        headers={"Authorization": auth["regional_token"]},
    )
    if status != 200:
        fail(f"list workspaces failed ({status})", response=str(ns_data)[:500])
    namespaces = ns_data.get("data") or []
    if isinstance(namespaces, dict):
        namespaces = namespaces.get("namespaces") or []
    current = (auth.get("current_workspace") or {}).get("id")
    print(
        json.dumps(
            {
                "current": current,
                "workspaces": [
                    {
                        "uid": ns.get("uid"),
                        "id": ns.get("id"),
                        "teamName": ns.get("teamName"),
                        "role": ns.get("role"),
                        "nstype": ns.get("nstype"),
                    }
                    for ns in namespaces
                ],
            },
            indent=2,
        )
    )


def cmd_switch(args):
    auth = regional_token_or_fail()
    status, ns_data = http_json(
        f"{auth['region']}/api/auth/namespace/list",
        headers={"Authorization": auth["regional_token"]},
    )
    if status != 200:
        fail(f"list workspaces failed ({status})", response=str(ns_data)[:500])
    namespaces = ns_data.get("data") or []
    if isinstance(namespaces, dict):
        namespaces = namespaces.get("namespaces") or []
    target = args.workspace.lower()
    match = next(
        (
            ns
            for ns in namespaces
            if target in (ns.get("id", "").lower(), ns.get("uid", "").lower())
            or target in ns.get("teamName", "").lower()
        ),
        None,
    )
    if not match:
        fail(
            f"no workspace matching '{args.workspace}'",
            available=[ns.get("id") for ns in namespaces],
        )

    status, switch_data = http_json(
        f"{auth['region']}/api/auth/namespace/switch",
        method="POST",
        headers={"Authorization": auth["regional_token"]},
        data={"ns_uid": match.get("uid")},
    )
    new_token = (switch_data.get("data") or {}).get("token") if isinstance(switch_data, dict) else None
    if status != 200 or not new_token:
        fail(f"switch workspace failed ({status})", response=str(switch_data)[:500])

    status, kc_data = http_json(
        f"{auth['region']}/api/auth/getKubeconfig", headers={"Authorization": new_token}
    )
    kubeconfig = (kc_data.get("data") or {}).get("kubeconfig") if isinstance(kc_data, dict) else None
    if status != 200 or not kubeconfig:
        fail(f"get kubeconfig failed ({status})", response=str(kc_data)[:500])

    workspace = {
        "uid": match.get("uid"),
        "id": match.get("id"),
        "teamName": match.get("teamName"),
    }
    save_credentials(auth["region"], auth.get("access_token"), new_token, kubeconfig, workspace)
    print(json.dumps({"switched": True, "workspace": workspace}, indent=2))


def cmd_deploy(args):
    if not os.path.exists(args.template):
        fail("template file not found", path=args.template)
    with open(args.template) as f:
        yaml_text = f.read()

    deploy_args = parse_deploy_args(args)
    kubeconfig = load_kubeconfig()
    domain = region_domain()
    url = f"https://template.{domain}/api/v2alpha/templates/raw"
    status, resp = http_json(
        url,
        method="POST",
        headers={"Authorization": urllib.parse.quote(kubeconfig, safe="")},
        data={"yaml": yaml_text, "args": deploy_args, "dryRun": bool(args.dry_run)},
        timeout=120,
    )
    ok = status in (200, 201)
    result = {
        "success": ok,
        "dry_run": bool(args.dry_run),
        "status": status,
        "deploy_url": url,
        "response": resp,
    }
    print(json.dumps(result, indent=2))
    if not ok:
        sys.exit(1)


def parse_deploy_args(args):
    deploy_args = {}
    if args.args_json:
        try:
            deploy_args = json.loads(args.args_json)
        except ValueError:
            fail("--args-json is not valid JSON")
    elif args.args_file:
        with open(args.args_file) as f:
            deploy_args = json.load(f)
    if not isinstance(deploy_args, dict):
        fail("deploy args must be a JSON object")
    return deploy_args


def cmd_deploy_store(args):
    import random
    import string

    name = args.name or (
        args.template + "-" + "".join(random.choices(string.ascii_lowercase, k=8))
    )
    kubeconfig = load_kubeconfig()
    domain = region_domain()
    url = f"https://template.{domain}/api/v2alpha/templates/instances"
    status, resp = http_json(
        url,
        method="POST",
        headers={"Authorization": urllib.parse.quote(kubeconfig, safe="")},
        data={"name": name, "template": args.template, "args": parse_deploy_args(args)},
        timeout=120,
    )
    print(
        json.dumps(
            {"success": status in (200, 201), "status": status, "instance": name, "response": resp},
            indent=2,
        )
    )
    if status not in (200, 201):
        sys.exit(1)


def cmd_store_get(args):
    domain = region_domain()
    status, resp = http_json(
        f"https://template.{domain}/api/v2alpha/templates/{urllib.parse.quote(args.template)}",
        timeout=30,
    )
    if status != 200:
        fail(f"template lookup failed ({status})", response=str(resp)[:500])
    out = resp if isinstance(resp, dict) else {"detail": resp}
    if args.yaml:
        status, src = http_json(
            f"https://template.{domain}/api/getTemplateSource"
            f"?templateName={urllib.parse.quote(args.template)}&includeReadme=false",
            headers={"Authorization": urllib.parse.quote(load_kubeconfig(), safe="")},
            timeout=30,
        )
        if status == 200 and isinstance(src, dict):
            data = src.get("data") or {}
            out["templateYaml"] = data.get("templateYaml")
            out["appYaml"] = data.get("appYaml")
        else:
            out["yaml_error"] = f"getTemplateSource failed ({status})"
    print(json.dumps(out, indent=2))


def cmd_instances(_args):
    domain = region_domain()
    status, resp = http_json(
        f"https://template.{domain}/api/instance/list",
        headers={"Authorization": urllib.parse.quote(load_kubeconfig(), safe="")},
        timeout=30,
    )
    if status != 200:
        fail(f"instance list failed ({status})", response=str(resp)[:500])
    items = resp.get("data") if isinstance(resp, dict) else resp
    if isinstance(items, dict):
        items = items.get("items") or items
    out = []
    if isinstance(items, list):
        for it in items:
            meta = it.get("metadata") or {}
            spec = it.get("spec") or {}
            out.append(
                {
                    "name": meta.get("name"),
                    "template": spec.get("title") or spec.get("templateType"),
                    "created": meta.get("creationTimestamp"),
                }
            )
        print(json.dumps({"count": len(out), "instances": out}, indent=2))
    else:
        print(json.dumps(resp, indent=2))


def cmd_delete(args):
    kubeconfig = load_kubeconfig()
    domain = region_domain()
    url = f"https://template.{domain}/api/v2alpha/templates/instances/{urllib.parse.quote(args.instance)}"
    status, resp = http_json(
        url,
        method="DELETE",
        headers={"Authorization": urllib.parse.quote(kubeconfig, safe="")},
        timeout=120,
    )
    ok = status in (200, 204)
    print(json.dumps({"success": ok, "status": status, "instance": args.instance, "response": resp or None}, indent=2))
    if not ok:
        sys.exit(1)


def cmd_store_list(args):
    domain = region_domain()
    status, resp = http_json(
        f"https://template.{domain}/api/listTemplate?language=en", timeout=30
    )
    if status != 200 or not isinstance(resp, dict):
        fail(f"listTemplate failed ({status})", response=str(resp)[:500])
    templates = (resp.get("data") or {}).get("templates") or []
    query = (args.search or "").lower()
    items = []
    for t in templates:
        meta = t.get("metadata") or {}
        spec = t.get("spec") or {}
        entry = {
            "name": meta.get("name"),
            "title": spec.get("title"),
            "description": (spec.get("description") or "")[:160],
            "categories": spec.get("categories") or [],
        }
        haystack = json.dumps(entry).lower()
        if not query or query in haystack:
            items.append(entry)
    print(json.dumps({"count": len(items), "templates": items}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status")

    p = sub.add_parser("login")
    p.add_argument("--region", help=f"region URL (default {DEFAULT_REGION}); known: {', '.join(KNOWN_REGIONS)}")

    sub.add_parser("workspaces")

    p = sub.add_parser("switch")
    p.add_argument("workspace", help="workspace id, uid, or team name")

    p = sub.add_parser("deploy")
    p.add_argument("template", help="path to a Sealos template YAML")
    p.add_argument("--args-json", help="deploy inputs as a JSON object string")
    p.add_argument("--args-file", help="deploy inputs as a JSON file (use for secrets)")
    p.add_argument("--dry-run", action="store_true")

    p = sub.add_parser("deploy-store")
    p.add_argument("template", help="template-store template name")
    p.add_argument("--name", help="instance name (default: <template>-<random8>)")
    p.add_argument("--args-json", help="template inputs as a JSON object string")
    p.add_argument("--args-file", help="template inputs as a JSON file (use for secrets)")

    p = sub.add_parser("store-list")
    p.add_argument("--search", help="case-insensitive filter")

    p = sub.add_parser("store-get")
    p.add_argument("template", help="template-store template name")
    p.add_argument("--yaml", action="store_true", help="include template source YAML")

    sub.add_parser("instances")

    p = sub.add_parser("delete")
    p.add_argument("instance", help="instance name to delete (removes all its resources)")

    args = parser.parse_args()
    {
        "status": cmd_status,
        "login": cmd_login,
        "workspaces": cmd_workspaces,
        "switch": cmd_switch,
        "deploy": cmd_deploy,
        "deploy-store": cmd_deploy_store,
        "store-list": cmd_store_list,
        "store-get": cmd_store_get,
        "instances": cmd_instances,
        "delete": cmd_delete,
    }[args.command](args)


if __name__ == "__main__":
    main()

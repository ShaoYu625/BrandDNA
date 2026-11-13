#!/usr/bin/env python3
"""One-command local development and deployment helper for BrandDNA."""

from __future__ import annotations

import argparse
import json
import getpass
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent
ROOT_ENV = ROOT / ".env"
API_DIR = ROOT / "api"
PAGES_DIR = ROOT / "pages"
API_DEV_VARS = API_DIR / ".dev.vars"
PAGES_DEV_VARS = PAGES_DIR / ".dev.vars"
API_DEV_VARS_EXAMPLE = API_DIR / ".dev.vars.example"
PAGES_DEV_VARS_EXAMPLE = PAGES_DIR / ".dev.vars.example"
API_WRANGLER = API_DIR / "wrangler.toml"
PAGES_WRANGLER = PAGES_DIR / "wrangler.toml"

LOCAL_API_URL = "http://127.0.0.1:8787"
LOCAL_PAGES_URL = "http://127.0.0.1:8788"
API_HEALTH_URL = f"{LOCAL_API_URL}/api/health"
PAGES_HEALTH_URL = f"{LOCAL_PAGES_URL}/api/health"

DEFAULT_PAGES_PROJECT = "branddna-demo-pages"
DEFAULT_D1_DATABASE = "branddna-demo-db"
DEFAULT_R2_BUCKET = "branddna-demo-r2"
NODE_INSTALL_HINT = "Install Node.js LTS from https://nodejs.org/ and reopen this terminal."


class CommandError(RuntimeError):
    pass


def info(message: str) -> None:
    print(f"[BrandDNA] {message}", flush=True)


def fail(message: str, code: int = 1) -> None:
    print(f"[BrandDNA] ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(code)


def write_console(text: str) -> None:
    encoding = sys.stdout.encoding or "utf-8"
    safe_text = text.encode(encoding, errors="replace").decode(encoding, errors="replace")
    print(safe_text, end="" if safe_text.endswith("\n") else "\n")


def command_name(name: str) -> str:
    if os.name == "nt" and not name.endswith(".cmd"):
        return f"{name}.cmd"
    return name


def which(name: str) -> str | None:
    return shutil.which(command_name(name)) or shutil.which(name)


def require_command(name: str, install_hint: str) -> str:
    found = which(name)
    if found:
        return found
    fail(f"Cannot find '{name}'. {install_hint}", 2)
    raise AssertionError("unreachable")


def npm_cmd() -> str:
    return require_command("npm", NODE_INSTALL_HINT)


def npx_cmd() -> str:
    return require_command("npx", NODE_INSTALL_HINT)


def run(
    cmd: list[str],
    *,
    cwd: Path = ROOT,
    check: bool = True,
    input_text: str | None = None,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    printable = " ".join(cmd)
    info(f"$ {printable}")
    result = subprocess.run(
        cmd,
        cwd=str(cwd),
        check=False,
        input=input_text,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    if capture and result.stdout:
        write_console(result.stdout)
    if check and result.returncode != 0:
        raise CommandError(f"Command failed with exit code {result.returncode}: {printable}")
    return result


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def add_to_path(path: str) -> None:
    if not path:
        return
    expanded = os.path.expandvars(path)
    parts = [part for part in os.environ.get("PATH", "").split(os.pathsep) if part]
    normalized = {os.path.normcase(os.path.normpath(part)) for part in parts}
    key = os.path.normcase(os.path.normpath(expanded))
    if key not in normalized:
        os.environ["PATH"] = os.pathsep.join([*parts, expanded])


def refresh_windows_path() -> None:
    if os.name != "nt":
        return

    try:
        import winreg
    except ImportError:
        winreg = None

    if winreg is not None:
        locations = [
            (winreg.HKEY_CURRENT_USER, "Environment"),
            (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        ]
        for root, subkey in locations:
            try:
                with winreg.OpenKey(root, subkey) as key:
                    value, _ = winreg.QueryValueEx(key, "Path")
            except OSError:
                continue
            for part in str(value).split(os.pathsep):
                add_to_path(part)

    add_to_path(r"C:\Program Files\nodejs")
    add_to_path(r"C:\Program Files (x86)\nodejs")
    appdata = os.environ.get("APPDATA")
    if appdata:
        add_to_path(str(Path(appdata) / "npm"))


def auto_install_node_lts() -> bool:
    refresh_windows_path()
    if which("node") and which("npm") and which("npx"):
        return True

    if os.name != "nt":
        return False

    winget = shutil.which("winget")
    if not winget:
        return False

    info("Node.js LTS is missing. Installing it with winget...")
    result = run(
        [
            winget,
            "install",
            "--id",
            "OpenJS.NodeJS.LTS",
            "-e",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ],
        check=False,
    )
    if result.returncode != 0:
        info("winget could not install Node.js automatically.")
        return False

    refresh_windows_path()
    return bool(which("node") and which("npm") and which("npx"))


def ensure_node(auto_install: bool) -> None:
    refresh_windows_path()
    if which("node") and which("npm") and which("npx"):
        return

    if auto_install and auto_install_node_lts():
        info("Node.js LTS is ready.")
        return

    fail(f"Cannot find 'node', 'npm', and 'npx'. {NODE_INSTALL_HINT}", 2)


def parse_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in read_text(path).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def looks_like_openai_api_key(value: str) -> bool:
    return value.startswith("sk-") and len(value) > 20


def copy_if_missing(source: Path, target: Path) -> None:
    if target.exists():
        return
    if not source.exists():
        fail(f"Missing template file: {source}")
    shutil.copyfile(source, target)
    info(f"Created {target.relative_to(ROOT)}")


def ensure_dev_vars(prompt_for_key: bool) -> None:
    copy_if_missing(API_DEV_VARS_EXAMPLE, API_DEV_VARS)
    copy_if_missing(PAGES_DEV_VARS_EXAMPLE, PAGES_DEV_VARS)

    api_values = parse_dotenv(API_DEV_VARS)
    current_key = api_values.get("OPENAI_API_KEY", "").strip()
    root_values = parse_dotenv(ROOT_ENV)
    env_key = os.environ.get("OPENAI_API_KEY", "").strip() or root_values.get("OPENAI_API_KEY", "").strip()

    if env_key and (not current_key or current_key == "your_openai_api_key" or not looks_like_openai_api_key(current_key)):
        replace_dotenv_value(API_DEV_VARS, "OPENAI_API_KEY", env_key)
        source = "environment" if os.environ.get("OPENAI_API_KEY", "").strip() else ".env"
        info(f"Copied OPENAI_API_KEY from {source} into api/.dev.vars")
        return

    if current_key and current_key != "your_openai_api_key":
        return

    if not prompt_for_key:
        info("OPENAI_API_KEY is not set yet. Pages and health checks work, but AI features will fail.")
        return

    if not sys.stdin.isatty():
        info("OPENAI_API_KEY is not set and this terminal is non-interactive.")
        return

    print("")
    print("OpenAI API key is needed for AI analysis/generation.")
    print("Press Enter to skip for now; you can edit api/.dev.vars later.")
    key = getpass.getpass("OPENAI_API_KEY: ").strip()
    if key:
        replace_dotenv_value(API_DEV_VARS, "OPENAI_API_KEY", key)
        info("Saved OPENAI_API_KEY to api/.dev.vars")
    else:
        info("Skipped OPENAI_API_KEY. AI features will fail until it is configured.")


def replace_dotenv_value(path: Path, key: str, value: str) -> None:
    lines = read_text(path).splitlines() if path.exists() else []
    found = False
    output: list[str] = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            output.append(f"{key}={value}")
            found = True
        else:
            output.append(line)
    if not found:
        output.append(f"{key}={value}")
    write_text(path, "\n".join(output) + "\n")


def install_dependencies(*, auto_install: bool = True) -> None:
    ensure_node(auto_install=auto_install)
    npm = npm_cmd()
    run([npm, "install"])


def local_checks(*, skip_typecheck: bool = False, skip_migration: bool = False) -> None:
    npm = npm_cmd()
    run([npm, "run", "render:pages"])
    if not skip_typecheck:
        run([npm, "run", "typecheck"])
    if not skip_migration:
        run([npm, "run", "d1:migrate:local"])


def setup(args: argparse.Namespace) -> None:
    ensure_dev_vars(prompt_for_key=not args.no_prompt)
    install_dependencies(auto_install=not args.no_auto_install)
    local_checks(skip_typecheck=args.skip_typecheck, skip_migration=args.skip_migration)
    info("Setup complete.")


def test(args: argparse.Namespace) -> None:
    ensure_dev_vars(prompt_for_key=not args.no_prompt)
    install_dependencies(auto_install=not args.no_auto_install)
    local_checks(skip_typecheck=args.skip_typecheck, skip_migration=args.skip_migration)
    info("System test checks complete.")


def wait_for_url(url: str, label: str, timeout_seconds: int = 45) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 500:
                    info(f"{label} is responding: {url}")
                    return True
        except (urllib.error.URLError, TimeoutError):
            time.sleep(1)
    info(f"{label} did not respond within {timeout_seconds}s: {url}")
    return False


def start(args: argparse.Namespace) -> None:
    setup(args)
    npm = npm_cmd()

    info("Starting local API Worker and Pages. Press Ctrl+C to stop both.")
    api_proc = subprocess.Popen([npm, "run", "dev:api"], cwd=str(ROOT), stdin=subprocess.DEVNULL)
    pages_proc = subprocess.Popen([npm, "run", "dev:pages"], cwd=str(ROOT), stdin=subprocess.DEVNULL)
    processes = [api_proc, pages_proc]

    def stop_processes(*_: object) -> None:
        info("Stopping local servers...")
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()
        time.sleep(2)
        for proc in processes:
            if proc.poll() is None:
                proc.kill()

    signal.signal(signal.SIGINT, stop_processes)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop_processes)

    wait_for_url(API_HEALTH_URL, "API Worker")
    wait_for_url(PAGES_HEALTH_URL, "Pages")

    info(f"Open the app: {LOCAL_PAGES_URL}")
    if not args.no_browser:
        webbrowser.open(LOCAL_PAGES_URL)

    try:
        while all(proc.poll() is None for proc in processes):
            time.sleep(1)
    finally:
        stop_processes()

    codes = [proc.returncode for proc in processes]
    if any(code not in (0, None) for code in codes):
        fail(f"One of the dev servers exited unexpectedly: {codes}")


def wrangler(args: Iterable[str], *, cwd: Path = ROOT, check: bool = True, capture: bool = False, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return run([npx_cmd(), "wrangler", *args], cwd=cwd, check=check, capture=capture, input_text=input_text)


def cloudflare_login_check() -> None:
    login_cmd = f"{npx_cmd()} wrangler login"
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    try:
        result = wrangler(["whoami"], check=True, capture=True)
    except CommandError:
        if token:
            fail("Cloudflare authentication failed even though CLOUDFLARE_API_TOKEN is set. Check the token permissions.", 2)
        fail(f"Cloudflare login is required. Run: {login_cmd}", 2)
    output = (result.stdout or "").lower()
    if "not authenticated" in output or "please run `wrangler login`" in output:
        if token:
            fail("Cloudflare authentication failed even though CLOUDFLARE_API_TOKEN is set. Check the token permissions.", 2)
        fail(f"Cloudflare login is required. Run: {login_cmd}", 2)


def update_d1_database_id(database_id: str) -> None:
    text = read_text(API_WRANGLER)
    updated = re.sub(r'database_id\s*=\s*"[^"]+"', f'database_id = "{database_id}"', text)
    if updated == text:
        fail("Could not find database_id in api/wrangler.toml")
    write_text(API_WRANGLER, updated)
    info(f"Updated api/wrangler.toml database_id = {database_id}")


def current_d1_database_id() -> str:
    match = re.search(r'database_id\s*=\s*"([^"]+)"', read_text(API_WRANGLER))
    return match.group(1) if match else ""


def d1_id_from_list_output(output: str, database_name: str) -> str | None:
    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        payload = None

    if isinstance(payload, list):
        for database in payload:
            if isinstance(database, dict) and database.get("name") == database_name:
                value = database.get("uuid") or database.get("id") or database.get("database_id")
                return str(value) if value else None

    for line in output.splitlines():
        if database_name not in line:
            continue
        uuid_match = re.search(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", line)
        if uuid_match:
            return uuid_match.group(0)
    return None


def lookup_d1_database_id(database_name: str) -> str | None:
    for args in (["d1", "list", "--json"], ["d1", "list"]):
        result = wrangler(args, capture=True, check=False)
        if result.returncode != 0:
            continue
        database_id = d1_id_from_list_output(result.stdout or "", database_name)
        if database_id:
            return database_id
    return None


def cloudflare_init(args: argparse.Namespace) -> None:
    ensure_dev_vars(prompt_for_key=not args.no_prompt)
    install_dependencies(auto_install=not args.no_auto_install)
    cloudflare_login_check()

    pages_project = args.pages_project
    d1_database = args.d1_database
    r2_bucket = args.r2_bucket

    wrangler(["pages", "project", "create", pages_project, "--production-branch", args.production_branch], check=False)

    database_id = current_d1_database_id()
    if not database_id or database_id == "00000000-0000-0000-0000-000000000000" or args.recreate_d1:
        result = wrangler(["d1", "create", d1_database], capture=True, check=False)
        match = re.search(r'database_id\s*=\s*"([^"]+)"', result.stdout or "")
        if match:
            update_d1_database_id(match.group(1))
        elif not args.recreate_d1:
            existing_database_id = lookup_d1_database_id(d1_database)
            if existing_database_id:
                update_d1_database_id(existing_database_id)
            elif result.returncode != 0:
                fail("D1 create failed and no existing database_id could be found from `wrangler d1 list`. If the DB already exists, paste its database_id into api/wrangler.toml.")
            else:
                fail("D1 was created, but database_id could not be parsed from Wrangler output.")
        elif result.returncode != 0:
            fail("D1 create failed and no database_id could be parsed. If the DB already exists, paste its database_id into api/wrangler.toml.")
        else:
            fail("D1 was created, but database_id could not be parsed from Wrangler output.")
    else:
        info(f"api/wrangler.toml already has database_id = {database_id}")

    wrangler(["r2", "bucket", "create", r2_bucket], check=False)
    set_worker_secret_from_dev_vars(prompt_for_key=not args.no_prompt)
    info("Cloudflare resources are initialized. Next run: python dev.py deploy")


def set_worker_secret_from_dev_vars(*, prompt_for_key: bool) -> None:
    ensure_dev_vars(prompt_for_key=prompt_for_key)
    key = parse_dotenv(API_DEV_VARS).get("OPENAI_API_KEY", "").strip()
    if not key or key == "your_openai_api_key":
        info("Skipping Cloudflare OPENAI_API_KEY secret because api/.dev.vars does not contain a real key.")
        return
    wrangler(["secret", "put", "OPENAI_API_KEY", "--config", "wrangler.toml"], cwd=API_DIR, input_text=f"{key}\n")
    info("Uploaded OPENAI_API_KEY as a Cloudflare Worker secret.")


def worker_origin_from_deploy_output(output: str) -> str | None:
    matches = re.findall(r"https://[^\s]+?\.workers\.dev", output)
    return matches[-1] if matches else None


def update_pages_deploy_config(api_origin: str) -> None:
    origin = api_origin.rstrip("/")
    lines = [
        line for line in read_text(PAGES_WRANGLER).splitlines()
        if not line.strip().startswith("API_WORKER_ORIGIN")
    ]
    vars_index = next((index for index, line in enumerate(lines) if line.strip() == "[vars]"), -1)
    if vars_index < 0:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend(["[vars]", f'API_WORKER_ORIGIN = "{origin}"'])
    else:
        section_end = len(lines)
        for index in range(vars_index + 1, len(lines)):
            stripped = lines[index].strip()
            if stripped.startswith("[") and stripped.endswith("]"):
                section_end = index
                break
        lines.insert(section_end, f'API_WORKER_ORIGIN = "{origin}"')
    write_text(PAGES_WRANGLER, "\n".join(lines).rstrip() + "\n")


def deploy(args: argparse.Namespace) -> None:
    ensure_dev_vars(prompt_for_key=not args.no_prompt)
    install_dependencies(auto_install=not args.no_auto_install)
    cloudflare_login_check()

    npm = npm_cmd()
    run([npm, "run", "render:pages"])
    if not args.skip_typecheck:
        run([npm, "run", "typecheck"])

    set_worker_secret_from_dev_vars(prompt_for_key=not args.no_prompt)
    run([npm, "run", "d1:migrate:remote"])

    api_deploy = wrangler(["deploy", "--config", "wrangler.toml"], cwd=API_DIR, capture=True)
    api_origin = args.api_origin or worker_origin_from_deploy_output(api_deploy.stdout or "")
    if not api_origin:
        api_origin = input("API Worker URL, for example https://branddna-demo-api.<subdomain>.workers.dev: ").strip()
    if not api_origin.startswith("https://"):
        fail("API Worker URL must start with https://")

    update_pages_deploy_config(api_origin)
    wrangler(["pages", "deploy", "public"], cwd=PAGES_DIR)

    info("Deployment complete.")
    info("For GitHub-linked Cloudflare Pages, push this repo to GitHub and connect it in the Cloudflare dashboard.")


def verify_url(url: str, label: str, timeout_seconds: int = 30) -> None:
    deadline = time.time() + timeout_seconds
    last_error = ""
    while time.time() < deadline:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "BrandDNA deploy verifier"})
            with urllib.request.urlopen(request, timeout=8) as response:
                status = response.status
                body = response.read(4096).decode("utf-8", errors="replace")
            if 200 <= status < 300:
                info(f"{label} OK: {url}")
                return
            last_error = f"HTTP {status}"
        except urllib.error.HTTPError as error:
            last_error = f"HTTP {error.code}"
        except urllib.error.URLError as error:
            last_error = str(error.reason)
        except TimeoutError:
            last_error = "timeout"
        time.sleep(2)
    fail(f"{label} did not become healthy at {url}: {last_error}")


def verify(args: argparse.Namespace) -> None:
    pages_origin = args.pages_origin.rstrip("/")
    api_origin = args.api_origin.rstrip("/") if args.api_origin else pages_origin

    verify_url(f"{api_origin}/api/health", "API health")
    verify_url(f"{pages_origin}/api/health", "Pages proxy health")
    for path in ["/", "/dashboard", "/data-hub", "/diagnosis", "/generate", "/gatekeeper", "/simulation"]:
        verify_url(f"{pages_origin}{path}", f"Page {path}")
    info("Remote verification complete.")


def doctor(_: argparse.Namespace) -> None:
    print("")
    refresh_windows_path()
    info("Environment report")
    for name in ["python", "node", "npm", "npx", "git"]:
        if name == "python":
            print(f"  python: {sys.version.split()[0]}")
            continue
        found = which(name)
        print(f"  {name}: {found or 'missing'}")
    print(f"  api/.dev.vars: {'exists' if API_DEV_VARS.exists() else 'missing'}")
    print(f"  pages/.dev.vars: {'exists' if PAGES_DEV_VARS.exists() else 'missing'}")
    print(f"  D1 database_id: {current_d1_database_id() or 'missing'}")
    print("")


def add_shared_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--skip-typecheck", action="store_true", help="Skip TypeScript type checking.")
    parser.add_argument("--skip-migration", action="store_true", help="Skip local D1 migration.")
    parser.add_argument("--no-prompt", action="store_true", help="Do not ask for missing secrets.")
    parser.add_argument("--no-auto-install", action="store_true", help="Do not auto-install missing local tools.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="BrandDNA local development and Cloudflare deployment helper.",
    )
    subparsers = parser.add_subparsers(dest="command")

    setup_parser = subparsers.add_parser("setup", help="Install dependencies and prepare local state.")
    add_shared_flags(setup_parser)
    setup_parser.set_defaults(func=setup)

    test_parser = subparsers.add_parser("test", help="Run setup checks without starting local servers.")
    add_shared_flags(test_parser)
    test_parser.set_defaults(func=test)

    start_parser = subparsers.add_parser("start", help="Setup and start local API + Pages servers.")
    add_shared_flags(start_parser)
    start_parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    start_parser.set_defaults(func=start)

    init_parser = subparsers.add_parser("cloudflare-init", help="Create Cloudflare resources and upload secrets.")
    init_parser.add_argument("--pages-project", default=DEFAULT_PAGES_PROJECT)
    init_parser.add_argument("--d1-database", default=DEFAULT_D1_DATABASE)
    init_parser.add_argument("--r2-bucket", default=DEFAULT_R2_BUCKET)
    init_parser.add_argument("--production-branch", default="main")
    init_parser.add_argument("--recreate-d1", action="store_true", help="Create a new D1 database even if wrangler.toml already has an id.")
    init_parser.add_argument("--no-prompt", action="store_true", help="Do not ask for missing secrets.")
    init_parser.add_argument("--no-auto-install", action="store_true", help="Do not auto-install missing local tools.")
    init_parser.set_defaults(func=cloudflare_init)

    deploy_parser = subparsers.add_parser("deploy", help="Build, migrate remote D1, deploy Worker and Pages.")
    deploy_parser.add_argument("--api-origin", help="Production Worker origin, for example https://branddna-demo-api.<subdomain>.workers.dev")
    deploy_parser.add_argument("--skip-typecheck", action="store_true", help="Skip TypeScript type checking.")
    deploy_parser.add_argument("--no-prompt", action="store_true", help="Do not ask for missing secrets.")
    deploy_parser.add_argument("--no-auto-install", action="store_true", help="Do not auto-install missing local tools.")
    deploy_parser.set_defaults(func=deploy)

    verify_parser = subparsers.add_parser("verify", help="Verify a deployed Pages URL and API health checks.")
    verify_parser.add_argument("pages_origin", help="Cloudflare Pages origin, for example https://branddna-demo-pages.pages.dev")
    verify_parser.add_argument("--api-origin", help="Worker origin if API health should be checked directly.")
    verify_parser.set_defaults(func=verify)

    doctor_parser = subparsers.add_parser("doctor", help="Print local environment diagnostics.")
    doctor_parser.set_defaults(func=doctor)

    parser.set_defaults(func=start)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if not hasattr(args, "skip_typecheck"):
        args.skip_typecheck = False
    if not hasattr(args, "skip_migration"):
        args.skip_migration = False
    if not hasattr(args, "no_prompt"):
        args.no_prompt = False
    if not hasattr(args, "no_browser"):
        args.no_browser = False
    if not hasattr(args, "no_auto_install"):
        args.no_auto_install = False
    try:
        args.func(args)
    except KeyboardInterrupt:
        fail("Interrupted. If Node.js installation was in progress, rerun this command to continue.", 130)
    except CommandError as error:
        fail(str(error))


if __name__ == "__main__":
    main()

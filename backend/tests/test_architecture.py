"""Guards the layering of the backend.

    main.py        application wiring only
    api/           HTTP layer: routers and request dependencies
    services/      business logic
    integrations/  external systems (Auth0, SMTP)
    workers/       background processes
    models, database, schemas, business_calendar: the data layer and shared helpers

Dependencies point downwards only. The business logic and the integrations must work without
the HTTP layer (the worker uses them directly), and nothing may depend on the application
module itself. The check reads the source files, so it costs nothing to run.
"""
import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

# package -> top-level modules it must never import
FORBIDDEN = {
    "services": {"api", "main", "workers", "scripts"},
    "integrations": {"api", "main", "services", "workers", "scripts"},
    "workers": {"api", "main"},
    "scripts": {"api", "main"},
    "api": {"main", "workers", "scripts"},
}
DATA_LAYER = ("models.py", "database.py", "schemas.py", "business_calendar.py")
DATA_LAYER_FORBIDDEN = {"api", "main", "services", "integrations", "workers", "scripts"}


def imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".")[0])
    return roots


def violations(paths, forbidden):
    found = []
    for path in paths:
        for root in sorted(imported_roots(path) & forbidden):
            found.append(f"{path.relative_to(BACKEND)} imports {root}")
    return found


def test_packages_only_depend_downwards():
    found = []
    for package, forbidden in FORBIDDEN.items():
        found += violations(sorted((BACKEND / package).rglob("*.py")), forbidden)
    assert found == []


def test_data_layer_depends_on_nothing_above_it():
    assert violations([BACKEND / name for name in DATA_LAYER], DATA_LAYER_FORBIDDEN) == []


def test_main_contains_no_endpoints():
    tree = ast.parse((BACKEND / "main.py").read_text(encoding="utf-8"))
    routes = [
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        for decorator in node.decorator_list
        if isinstance(decorator, ast.Call)
        and isinstance(decorator.func, ast.Attribute)
        and decorator.func.attr in {"get", "post", "put", "patch", "delete"}
    ]
    assert routes == []

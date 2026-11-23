"""Safety net for restructuring the backend: the public API must not change.

route_snapshot.json lists every endpoint as "METHOD path handler-name". Moving code between
modules or routers must keep this list identical. If an endpoint is added, removed or renamed
on purpose, regenerate the snapshot (see regenerate() below) and review the diff.
"""
import json
import re
from pathlib import Path

from fastapi.routing import APIRoute
from starlette.routing import Match

import main

SNAPSHOT = Path(__file__).with_name("route_snapshot.json")


def flatten(routes):
    """Endpoints in registration order; routers included with include_router() are expanded in place."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "effective_route_contexts"):  # FastAPI's included router
            yield from route.effective_route_contexts()


def api_routes():
    return list(flatten(main.app.router.routes))


def current_entries():
    return sorted({f"{method} {route.path} {route.name}" for route in api_routes() for method in route.methods})


def regenerate():
    """Run `python -c "from tests.test_route_snapshot import regenerate; regenerate()"` after an intended API change."""
    SNAPSHOT.write_text(json.dumps(current_entries(), indent=1) + "\n")


def test_endpoints_match_the_snapshot():
    expected = json.loads(SNAPSHOT.read_text())
    current = current_entries()
    missing = sorted(set(expected) - set(current))
    added = sorted(set(current) - set(expected))
    assert not missing and not added, f"Missing endpoints: {missing}\nUnexpected endpoints: {added}"


def sample_path(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def resolve(method: str, path: str):
    """The first endpoint that would handle this request, walking the routes in order like the router does."""
    scope = {"type": "http", "method": method, "path": path, "root_path": "", "path_params": {}}
    for route in api_routes():
        match, _child = route.matches(scope)
        if match == Match.FULL:
            return route
    return None


def test_every_endpoint_is_reached_by_its_own_requests():
    # Guards route order: a generic path such as /forms/{form_id} must never capture /forms/ai/generate.
    wrong = []
    for route in api_routes():
        for method in route.methods:
            chosen = resolve(method, sample_path(route.path))
            if chosen is None or (chosen.path, chosen.name) != (route.path, route.name):
                wrong.append(f"{method} {route.path} -> {getattr(chosen, 'path', None)}")
    assert not wrong, "Requests reach the wrong endpoint:\n" + "\n".join(wrong)

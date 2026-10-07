"""Snapshot the supplied OpenAPI documents and derive browser-safe schema metadata.

No services are contacted. Run from the project root. --source updates snapshots;
without --source generation uses the committed contracts. --check never writes.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
FILES = {name: "openapi.json" for name in [
    "users", "organizations", "assets", "rules", "actions", "email", "sms", "push", "mqtt", "mqttbridge"
]}
FILES["core"] = "compat.openapi.json"
# Resource, service, response schema, create schema, update schema, primary key.
RESOURCES = [
    ("organizations", "organizations", "Organization", "OrganizationWrite", "OrganizationWrite", "m_nIDOrganization"),
    ("organizationstypes", "organizations", "OrganizationType", "OrganizationTypeWrite", "OrganizationTypeWrite", "m_nIDOrganizationType"),
    ("users", "users", "Users", "UsersRequest", "UsersRequest", "m_nIDuser"),
    ("usergroups", "users", "Usergroups", "UsergroupsRequest", "UsergroupsRequest", "m_nIDusergroup"),
    ("usertypes", "users", "Usertypes", "UsertypesRequest", "UsertypesRequest", "m_nIDUserType"),
    ("authz", "users", "Authz", "AuthzRequest", "AuthzRequest", "m_nIDauthz"),
    ("entities", "users", "Entities", "EntitiesRequest", "EntitiesRequest", "m_nIDentity"),
    ("userlog", "users", "Userlog", "UserlogRequest", "UserlogRequest", "IDUserlog"),
    ("assets", "assets", "Asset", "AssetWrite", "AssetWrite", "m_nIDAsset"),
    ("assettypes", "assets", "AssetType", "AssetTypeWrite", "AssetTypeWrite", "m_nIDAssetType"),
    *[(r, "core", s, s+"Create", s+"Update", "m_nID"+s) for r,s in [
        ("hubs","Hub"),("hubtypes","HubType"),("devices","Device"),("devicetypes","DeviceType"),
        ("sensors","Sensor"),("sensortypes","SensorType")]],
    ("rules", "rules", "Rules", "RulesRequest", "RulesRequest", "m_nIDRule"),
    ("ruletypes", "rules", "Ruletypes", "RuletypesRequest", "RuletypesRequest", "m_nIDRuleType"),
    ("rulesforward", "rules", "Rulesforward", "RulesforwardRequest", "RulesforwardRequest", "m_nIDRuleForwarded"),
    ("actions", "actions", "Actions", "ActionsRequest", "ActionsRequest", "m_nIDAction"),
    ("actiontypes", "actions", "Actiontypes", "ActiontypesRequest", "ActiontypesRequest", "m_nIDActionType"),
    ("actionsforward", "actions", "Actionsforward", "ActionsforwardRequest", "ActionsforwardRequest", "m_nIDActionForward"),
]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    docs, hashes = {}, {}
    for service, filename in FILES.items():
        target = ROOT / "contracts" / service / filename
        source = args.source / service / filename if args.source else target
        raw = source.read_bytes()
        docs[service] = json.loads(raw)
        hashes[service] = {"file": f"{service}/{filename}", "sha256": hashlib.sha256(raw).hexdigest()}
        if args.source and not args.check:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)

    def resolve(service, schema):
        if "$ref" in schema:
            return resolve(service, docs[service]["components"]["schemas"][schema["$ref"].split("/")[-1]])
        if "allOf" in schema:
            out = {**schema, "properties": dict(schema.get("properties", {})), "required": list(schema.get("required", []))}
            for part in schema["allOf"]:
                part = resolve(service, part)
                out["properties"].update(part.get("properties", {}))
                out["required"].extend(part.get("required", []))
            return out
        return schema

    def fields(service, schema):
        schema = resolve(service, schema)
        required = set(schema.get("required", []))
        # Core expresses required logical fields as a choice of input aliases.
        for constraint in schema.get("allOf", []):
            choices = constraint.get("anyOf", [])
            if choices and all(len(c.get("required", [])) == 1 for c in choices):
                required.add(choices[0]["required"][0])
        return [{**field(service, k, v), **({"required": True} if k in required else {})}
                for k, v in schema.get("properties", {}).items()]

    def field(service, key, schema):
        schema = resolve(service, schema)
        variants = schema.get("anyOf", schema.get("oneOf", []))
        kinds = schema.get("type", [])
        if isinstance(kinds, str): kinds = [kinds]
        if variants:
            kinds = [resolve(service, s).get("type") for s in variants]
            schema = {**resolve(service, next((s for s in variants if resolve(service,s).get("type") != "null"), {})), **schema}
        kind = next((k for k in kinds if k and k != "null"), "string")
        return {"key": key, "type": kind, "nullable": "null" in kinds,
                **{k: str(schema[k]) if k in ("minimum","maximum") else schema[k]
                   for k in ("description", "maxLength", "minimum", "maximum", "enum", "pattern", "format") if k in schema}}

    resources = {}
    for name, service, response, create, update, primary in RESOURCES:
        schemas = docs[service]["components"]["schemas"]
        response_schema = resolve(service, schemas[response])
        if primary not in response_schema.get("properties", {}):
            primary = primary.removeprefix("m_n")
        if primary not in response_schema.get("properties", {}):
            raise ValueError(f"Missing primary key for {name}: {primary}")
        paths = docs[service]["paths"]
        base = "/v1/" + name
        detail = next((p for p in paths if re.fullmatch(re.escape(base)+r"/\{[^}]+\}", p)), None)
        routes = {m: base if m in ("list", "create") else detail for m in ("list","create","show","edit","delete")}
        if name == "organizationstypes":
            routes["edit"] = "/v1/organizationstypes/v1/organizationtypes/{entity_id}"
        methods = {"list":"get", "show":"get", "create":"post", "edit":"put", "delete":"delete"}
        routes = {k:v for k,v in routes.items() if v and methods[k] in paths.get(v,{})}
        resources[name] = {
            "service": service, "primaryKey": primary, "routes": routes,
            "fields": [field(service,k,v) for k,v in response_schema.get("properties",{}).items()],
            "createFields": fields(service, schemas[create]),
            "updateFields": fields(service, schemas[update]),
            "query": [field(service, p["name"], p.get("schema",{})) for p in paths[base]["get"].get("parameters",[]) if p["in"] == "query" and p["name"] != "entity_id"],
            "description": paths[base]["get"].get("description", ""),
        }
    asset_assignments = {}
    for kind in ("users", "usergroups"):
        path = f"/v1/assets/{{asset_id}}/{kind}/{{related_id}}"
        operations = docs["assets"]["paths"].get(path, {})
        if not all(method in operations for method in ("post", "delete")):
            raise ValueError(f"Missing Assets assignment operations for {kind}")
        asset_assignments[kind] = {"add": path, "remove": path}
    generated = json.dumps({"resources":resources, "assetAssignments":asset_assignments, "sources":hashes}, indent=2, ensure_ascii=False)+"\n"
    target = ROOT / "shared" / "contracts.generated.json"
    if args.check:
        if target.read_text(encoding="utf-8") != generated: raise SystemExit("Generated contract metadata is stale")
    else:
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(generated,encoding="utf-8",newline="\n")
    print(f"Validated {len(docs)} API documents and {len(resources)} resource definitions.")

if __name__ == "__main__": main()

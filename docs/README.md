# Engineering Specification Index

- [Product specification](PRODUCT_SPEC.md)
- [System architecture](architecture/system.md)
- [Application structure](architecture/applications.md)
- [OpenAPI contract](api/openapi.yaml)
- [WebSocket protocol](api/websocket.md)
- [PostgreSQL schema](database/schema.sql)
- [Security model and release gates](security/threat-model.md)
- [26-phase delivery roadmap](roadmap.md)
- [Local infrastructure](../infrastructure/docker-compose.yml)

## Local stack

Copy `.env.example` to `.env`, replace every local-only secret, then run:

```powershell
docker compose -f infrastructure/docker-compose.yml up --build
```

Optional TURN and reverse-proxy profiles:

```powershell
docker compose -f infrastructure/docker-compose.yml --profile relay --profile edge up --build
```

The Compose `prototype` service is the existing MVP, not the future authenticated API. PostgreSQL and Redis are initialized now so the production control-plane work can be introduced incrementally without removing the working prototype.


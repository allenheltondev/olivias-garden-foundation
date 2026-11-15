# Store public API smoke checks

Run the read-only Postman collection against a deployed Store API base URL:

```sh
npx --yes newman@6.2.1 run postman/store-api-smoke.postman_collection.json --env-var "baseUrl=https://api.example.org/store" --timeout-request 30000
```

The shared-domain base URL includes `/store`; a direct execute-api URL includes `/api`. The collection checks catalog fields, missing products, unknown routes, correlation IDs, and unauthenticated denial for customer and admin orders. It never creates products or orders and never starts checkout. An empty catalog is valid.

Both the staging PR deployment and the main deployment run this collection after deploying the Store backend, using its `ApiUrl` output. A failure blocks dependent frontend deployment. Routing unit tests also cover custom-domain prefixes, the direct stage prefix, and API Gateway's relative proxy capture.

The production audit observed application 404 responses for `/store/products` and `/store/orders`. Source routing previously removed only `/api`; the handler now prefers the proxy capture and supports the `/store` prefix fallback. Production recovery must be verified after the PR is approved, merged, and deployed. Local AWS credentials did not provide access to this application's production stack, so no production log diagnosis or manual deployment was performed.

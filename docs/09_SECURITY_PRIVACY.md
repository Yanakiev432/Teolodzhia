# 09. Security and privacy

## Never commit

- API key values
- OAuth tokens
- credentials.json
- token.json
- GitHub PATs
- Cloudflare API tokens
- private keys
- browser/session cookies

## Allowed

Symbolic runtime secret names such as APPS_SCRIPT_SECRET and GPT_ACTION_KEY may appear in source code. Their values must not.

## Action authentication

Production uses API Key authentication configured in the Custom GPT editor. The key is absent from this repository.

Privacy endpoint: https://teolodzhia-library-proxy.yanakiev-ivan.workers.dev/privacy

## Repository visibility

This repository is frozen as **private** by default. Making it public is a separate decision.

# pexels

Cloudflare Worker proxy API for Pexels photo and video search.

## Endpoints

- `GET /health`
- `GET /v1/photos?q=cat&orientation=portrait&page=1&per_page=30`
- `GET /v1/videos?q=rain&orientation=portrait&page=1&per_page=30`
- `GET /v1/search?q=coffee&type=photos|videos`

The Pexels API token is stored as the Cloudflare Worker secret `PEXELS_API_KEY` and is never committed to GitHub.

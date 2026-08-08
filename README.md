# 🧭 FareScout

*Scouting the best fares — flights, hotels, and complete trips.*

Streamlit app that searches Google Flights and Google Hotels (via
[searchapi.io](https://www.searchapi.io) or [serpapi.com](https://serpapi.com)), with an
AI agent mode that decomposes complex natural-language trip requests — flexible dates,
multiple airports, mixed cabin classes, hotel requirements, combined budgets — into
individual searches and synthesizes a complete trip.

Default agent model: **gpt-5-mini** — strong tool-calling at a fraction of gpt-5's price.

## Run locally

```bash
pip install -r requirements.txt
export SEARCHAPI_API_KEY="..."   # searchapi.io key (or SERPAPI_API_KEY)
export OPENAI_API_KEY="sk-..."   # only needed for the AI Agent tab
streamlit run streamlit_app.py
```

With no keys set, the app starts in **demo mode** and renders bundled sample results.

## Deploy on Streamlit Community Cloud

1. Push this repo to GitHub.
2. Go to [share.streamlit.io](https://share.streamlit.io) → **Create app** → pick this
   repo, branch `main`, main file `streamlit_app.py`.
3. In **Advanced settings → Secrets**, paste the contents of
   `.streamlit/secrets.toml.example` with your real keys.
4. Deploy. The app reads keys from Streamlit secrets automatically.

⚠️ With your keys in the app's secrets, every visitor's search spends your API credits —
keep the URL to yourself or enable viewer authentication in the app settings.

## Files

- `streamlit_app.py` — the UI (flight search, hotel search, AI agent chat)
- `travel_search.py` — provider-agnostic flight + hotel search, filtering, ranking,
  and the OpenAI tool-calling `TravelAgent`
- `sample_flights.json` / `sample_hotels.json` — demo-mode data

## Notes

- Car rentals aren't searchable through these providers; the agent offers a pre-filled
  Kayak link instead.
- Flight prices are Google Flights snapshots — fares are confirmed on click-through.

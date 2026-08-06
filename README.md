# ✈️ Flight Finder

Streamlit app for searching Google Flights (via [searchapi.io](https://www.searchapi.io) or
[serpapi.com](https://serpapi.com)), with an AI agent mode that decomposes complex
natural-language trip requests (flexible dates, multiple airports, mixed cabin classes,
budget rules) into individual searches and synthesizes an itinerary.

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
2. Go to [share.streamlit.io](https://share.streamlit.io) → **New app** → pick this repo,
   branch `main`, main file `streamlit_app.py`.
3. In **Advanced settings → Secrets**, paste the contents of
   `.streamlit/secrets.toml.example` with your real keys.
4. Deploy. The app reads keys from Streamlit secrets automatically.

⚠️ With your keys in the app's secrets, every visitor's search spends your API credits —
keep the URL to yourself or enable viewer authentication in the app settings.

## Files

- `streamlit_app.py` — the UI (search form + AI agent chat)
- `flight_search.py` — provider-agnostic search, filtering, ranking, and the
  OpenAI tool-calling `FlightAgent`
- `sample_flights.json` — demo-mode data

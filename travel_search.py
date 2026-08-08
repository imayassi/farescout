"""
Core travel-search logic (Google Flights + Google Hotels) shared by the
FareScout Streamlit UI (travel_agent.py) and the notebook (travel agent.ipynb).

Supports two providers with near-identical Google Flights schemas:
  - searchapi.io  (https://www.searchapi.io/api/v1/search)
  - serpapi.com   (https://serpapi.com/search)

API keys are read from environment variables — never hardcode them:
  SEARCHAPI_API_KEY, SERPAPI_API_KEY, OPENAI_API_KEY
"""

from __future__ import annotations

import datetime
import json
import os
from typing import Any, Callable, Optional

import requests

PROVIDER_ENDPOINTS = {
    "searchapi": "https://www.searchapi.io/api/v1/search",
    "serpapi": "https://serpapi.com/search",
}

TRAVEL_CLASSES = ["economy", "premium_economy", "business", "first_class"]

# serpapi encodes travel_class as an integer; searchapi takes the string.
_SERPAPI_CLASS_MAP = {"economy": 1, "premium_economy": 2, "business": 3, "first_class": 4}
# serpapi stops: 0=any, 1=nonstop, 2=one stop or fewer, 3=two stops or fewer
_SERPAPI_STOPS_MAP = {"any": 0, "nonstop": 1, "one_stop_or_fewer": 2, "two_stops_or_fewer": 3}


class FlightSearchError(Exception):
    """Raised when the flight API call fails or returns an error payload."""


def format_minutes_to_hm(minutes: int) -> str:
    """Converts minutes to a 'Xh Ym' format."""
    return f"{minutes // 60}h {minutes % 60}m"


def search_flights(
    departure_id: str,
    arrival_id: str,
    outbound_date: str,
    return_date: Optional[str] = None,
    travel_class: Optional[str] = None,
    adults: int = 1,
    children: int = 0,
    infants_on_lap: int = 0,
    stops: Optional[str] = None,  # "any" | "nonstop" | "one_stop_or_fewer" | "two_stops_or_fewer"
    max_flight_duration: Optional[int] = None,  # minutes
    provider: str = "searchapi",
    api_key: Optional[str] = None,
) -> dict:
    """Calls the flight API and returns the raw JSON payload.

    Raises FlightSearchError on transport failures or API-level errors.
    """
    if provider not in PROVIDER_ENDPOINTS:
        raise FlightSearchError(f"Unknown provider '{provider}'. Use one of {list(PROVIDER_ENDPOINTS)}.")

    if api_key is None:
        env_var = "SEARCHAPI_API_KEY" if provider == "searchapi" else "SERPAPI_API_KEY"
        api_key = os.environ.get(env_var, "")
    if not api_key:
        raise FlightSearchError(
            f"No API key for {provider}. Set the environment variable or pass api_key explicitly."
        )

    params: dict[str, Any] = {
        "engine": "google_flights",
        "departure_id": departure_id.strip().upper(),
        "arrival_id": arrival_id.strip().upper(),
        "outbound_date": outbound_date,
        "hl": "en",
        "api_key": api_key,
    }

    if return_date:
        params["return_date"] = return_date
        if provider == "searchapi":
            params["flight_type"] = "round_trip"
        else:
            params["type"] = 1  # serpapi: 1 = round trip
    else:
        if provider == "searchapi":
            params["flight_type"] = "one_way"
        else:
            params["type"] = 2  # serpapi: 2 = one way

    if travel_class:
        if provider == "searchapi":
            params["travel_class"] = travel_class
        else:
            params["travel_class"] = _SERPAPI_CLASS_MAP.get(travel_class, 1)

    if adults and adults != 1:
        params["adults"] = adults
    if children:
        params["children"] = children
    if infants_on_lap:
        params["infants_on_lap"] = infants_on_lap

    if stops and stops != "any":
        if provider == "searchapi":
            params["stops"] = stops
        else:
            params["stops"] = _SERPAPI_STOPS_MAP.get(stops, 0)

    if max_flight_duration:
        params["max_flight_duration" if provider == "searchapi" else "max_duration"] = max_flight_duration

    try:
        response = requests.get(PROVIDER_ENDPOINTS[provider], params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as e:
        raise FlightSearchError(f"Failed to reach {provider}: {e}") from e
    except ValueError as e:
        raise FlightSearchError(f"{provider} returned a non-JSON response: {e}") from e

    if "error" in data:
        raise FlightSearchError(f"{provider} error: {data['error']}")
    return data


def extract_flights(data: dict) -> list[dict]:
    """Merges best_flights + other_flights from a raw payload into one list."""
    return list(data.get("best_flights", [])) + list(data.get("other_flights", []))


def booking_link(data: dict) -> Optional[str]:
    """Best-effort Google Flights link from the search metadata."""
    meta = data.get("search_metadata", {})
    return meta.get("google_flights_url") or meta.get("request_url")


def filter_flights(
    flights: list[dict],
    max_duration_minutes: Optional[int] = None,
    exclude_aircraft: Optional[list[str]] = None,
    max_price: Optional[float] = None,
) -> list[dict]:
    """Client-side filtering on top of whatever the API already applied."""
    exclude_aircraft = [a.lower() for a in (exclude_aircraft or [])]
    out = []
    for flight in flights:
        if max_duration_minutes and flight.get("total_duration", 0) > max_duration_minutes:
            continue
        if max_price is not None and flight.get("price") is not None and flight["price"] > max_price:
            continue
        legs = flight.get("flights", [])
        if exclude_aircraft and any(
            ac in leg.get("airplane", "").lower() for leg in legs for ac in exclude_aircraft
        ):
            continue
        out.append(flight)
    return out


def rank_flights(flights: list[dict], weight_price: float = 0.5, weight_duration: float = 0.4,
                 weight_carbon: float = 0.1) -> list[dict]:
    """Sorts flights by a weighted blend of price, duration, and carbon.

    Each dimension is normalized to [0, 1] across the result set so the
    weights are comparable (the old version mixed raw units, which let
    price dominate silently).
    """
    if not flights:
        return []

    def spread(values: list[float]) -> tuple[float, float]:
        lo, hi = min(values), max(values)
        return lo, (hi - lo) or 1.0

    prices = [f.get("price") or 10**6 for f in flights]
    durations = [f.get("total_duration") or 10**6 for f in flights]
    carbons = [f.get("carbon_emissions", {}).get("this_flight") or 0 for f in flights]
    p_lo, p_rng = spread(prices)
    d_lo, d_rng = spread(durations)
    c_lo, c_rng = spread(carbons)

    def score(f: dict) -> float:
        p = ((f.get("price") or 10**6) - p_lo) / p_rng
        d = ((f.get("total_duration") or 10**6) - d_lo) / d_rng
        c = ((f.get("carbon_emissions", {}).get("this_flight") or 0) - c_lo) / c_rng
        return weight_price * p + weight_duration * d + weight_carbon * c

    return sorted(flights, key=score)


def summarize_for_llm(search_params: dict, data: dict, top_n: int = 5) -> str:
    """Condenses a raw payload into a short string for the agent's context window."""
    flights = extract_flights(data)
    if not flights:
        return (
            f"No flights found for {search_params.get('departure_id')} -> "
            f"{search_params.get('arrival_id')} on {search_params.get('outbound_date')}"
        )

    flights = sorted(flights, key=lambda f: f.get("price") or 10**6)
    link = booking_link(data) or "N/A"
    lines = [
        f"Results {search_params.get('departure_id')} -> {search_params.get('arrival_id')} "
        f"on {search_params.get('outbound_date')} (class: {search_params.get('travel_class', 'economy')}):"
    ]
    for f in flights[:top_n]:
        stops = len(f.get("layovers", []))
        airlines = ", ".join(sorted({leg.get("airline", "?") for leg in f.get("flights", [])}))
        lines.append(
            f"  - ${f.get('price', '?')}, {format_minutes_to_hm(f.get('total_duration', 0))}, "
            f"{'nonstop' if stops == 0 else f'{stops} stop(s)'}, {airlines}"
        )
    lines.append(f"  Booking link: {link}")
    return "\n".join(lines)


# --------------------------- The AI agent ---------------------------

AGENT_SYSTEM_PROMPT = """
You are FareScout, an expert travel agent. Your goal is to find the best flight
and hotel options for the user, even when the query is complex.

**Your core task is to DECOMPOSE complex queries.**

A complex query has one or more of:
- Multi-city routes (e.g., LAX to MAD, then CDG to LAX)
- Flexible dates (e.g., "anytime between 12/13 and 12/15")
- Flexible airports (e.g., "to LAX or SAN")
- Mixed travel classes (e.g., "outbound business, return economy")
- Hotel requirements (e.g., "4-star near the Marais under $250/night")
- Budget constraints (e.g., "under $10000 total for flights and hotel")

**Your method:**
1. Reason: state your plan, breaking the query into simple searches.
2. Act: call `google_flights_search` for EACH simple flight leg — once per date
   for flexible dates, once per airport for flexible airports, with the right
   `travel_class` per segment — and `google_hotels_search` for each lodging need
   (derive check-in/check-out from the chosen or likely flight dates).
3. Observe the summarized results of each call.
4. Synthesize: combine the best options (e.g., cheapest outbound + best return
   + best-value hotel that satisfies the stated requirements).
5. Filter against the user's constraints, including TOTAL trip budget across
   flights and hotel nights.
6. Answer with the final itinerary: per-leg flight prices, hotel name and
   nightly/total rate, combined total, and booking links.

If the user asks about car rentals, say you can't search them live and offer a
pre-filled link of the form https://www.kayak.com/cars/<CITY>/<YYYY-MM-DD>/<YYYY-MM-DD>.

Keep tool calls focused: never issue more than ~12 searches for one query; if the
query would need more, search the most promising subset and say what you skipped.

Today's date is {today}. Use it to resolve relative dates; assume the next future
occurrence when the year is not specified.
"""

AGENT_TOOL_SPEC = [
    {
        "type": "function",
        "function": {
            "name": "google_flights_search",
            "description": "Searches Google Flights for one-way or round-trip flights.",
            "parameters": {
                "type": "object",
                "properties": {
                    "departure_id": {"type": "string", "description": "3-letter IATA departure airport code, e.g. 'LAX'."},
                    "arrival_id": {"type": "string", "description": "3-letter IATA arrival airport code, e.g. 'MAD'."},
                    "outbound_date": {"type": "string", "description": "Departure date, YYYY-MM-DD."},
                    "return_date": {"type": "string", "description": "Optional return date (YYYY-MM-DD) for round trips."},
                    "travel_class": {"type": "string", "enum": TRAVEL_CLASSES},
                    "adults": {"type": "integer", "minimum": 1},
                    "children": {"type": "integer", "minimum": 0},
                    "infants_on_lap": {"type": "integer", "minimum": 0},
                    "stops": {"type": "string", "enum": ["any", "nonstop", "one_stop_or_fewer", "two_stops_or_fewer"]},
                    "max_flight_duration": {"type": "integer", "description": "Max total duration in minutes."},
                },
                "required": ["departure_id", "arrival_id", "outbound_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "google_hotels_search",
            "description": "Searches Google Hotels for places to stay in a location and date range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "q": {"type": "string", "description": "Location query, e.g. 'hotels near the Marais, Paris'."},
                    "check_in_date": {"type": "string", "description": "Check-in date, YYYY-MM-DD."},
                    "check_out_date": {"type": "string", "description": "Check-out date, YYYY-MM-DD."},
                    "adults": {"type": "integer", "minimum": 1},
                    "children": {"type": "integer", "minimum": 0},
                },
                "required": ["q", "check_in_date", "check_out_date"],
            },
        },
    },
]


class TravelAgent:
    """OpenAI tool-calling loop over flight and hotel search.

    on_event, if given, receives (kind, text) progress callbacks with kinds:
    'thinking', 'tool_call', 'tool_result', 'answer'. This lets the Streamlit
    UI stream progress without the agent knowing about Streamlit.
    """

    def __init__(
        self,
        model: str = "gpt-5-mini",
        provider: str = "searchapi",
        search_api_key: Optional[str] = None,
        openai_api_key: Optional[str] = None,
        max_rounds: int = 8,
        on_event: Optional[Callable[[str, str], None]] = None,
    ):
        import openai  # local import so the search half works without the SDK

        self.client = openai.OpenAI(api_key=openai_api_key or os.environ.get("OPENAI_API_KEY"))
        self.model = model
        self.provider = provider
        self.search_api_key = search_api_key
        self.max_rounds = max_rounds
        self.on_event = on_event or (lambda kind, text: None)

    def _flight_tool(self, **kwargs) -> str:
        try:
            data = search_flights(provider=self.provider, api_key=self.search_api_key, **kwargs)
            return summarize_for_llm(kwargs, data)
        except FlightSearchError as e:
            return f"Error: {e}"

    def _hotel_tool(self, **kwargs) -> str:
        try:
            data = search_hotels(provider=self.provider, api_key=self.search_api_key, **kwargs)
            return summarize_hotels_for_llm(kwargs, data)
        except FlightSearchError as e:
            return f"Error: {e}"

    def _describe_call(self, name: str, args: dict) -> str:
        if name == "google_hotels_search":
            return f"🏨 {args.get('q')} · {args.get('check_in_date')} → {args.get('check_out_date')}"
        return (
            f"✈️ {args.get('departure_id')} → {args.get('arrival_id')} on {args.get('outbound_date')}"
            + (f" ({args['travel_class']})" if args.get("travel_class") else "")
        )

    def run(self, user_query: str) -> str:
        """Runs the agent loop and returns the final answer text."""
        messages: list[dict] = [
            {"role": "system", "content": AGENT_SYSTEM_PROMPT.format(today=datetime.date.today())},
            {"role": "user", "content": user_query},
        ]

        for _ in range(self.max_rounds):
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=AGENT_TOOL_SPEC,
                tool_choice="auto",
            )
            msg = response.choices[0].message
            messages.append(msg)

            if not msg.tool_calls:
                answer = msg.content or "(no answer)"
                self.on_event("answer", answer)
                return answer

            if msg.content:
                self.on_event("thinking", msg.content)

            for call in msg.tool_calls:
                try:
                    args = json.loads(call.function.arguments)
                except json.JSONDecodeError as e:
                    result = f"Error: could not parse arguments: {e}"
                else:
                    self.on_event("tool_call", self._describe_call(call.function.name, args))
                    tool_fn = {
                        "google_flights_search": self._flight_tool,
                        "google_hotels_search": self._hotel_tool,
                    }.get(call.function.name)
                    result = tool_fn(**args) if tool_fn else f"Error: unknown tool {call.function.name}"
                self.on_event("tool_result", result)
                messages.append(
                    {"tool_call_id": call.id, "role": "tool", "name": call.function.name, "content": result}
                )

        final = "I ran out of search rounds before finishing. Here's what I found so far — try narrowing the query."
        self.on_event("answer", final)
        return final


# --------------------------- Hotels ---------------------------

def search_hotels(
    q: str,
    check_in_date: str,
    check_out_date: str,
    adults: int = 2,
    children: int = 0,
    provider: str = "searchapi",
    api_key: Optional[str] = None,
) -> dict:
    """Calls the Google Hotels engine and returns the raw JSON payload.

    q is a location query, e.g. "hotels near the Marais, Paris".
    Raises FlightSearchError on transport failures or API-level errors.
    """
    if provider not in PROVIDER_ENDPOINTS:
        raise FlightSearchError(f"Unknown provider '{provider}'. Use one of {list(PROVIDER_ENDPOINTS)}.")

    if api_key is None:
        env_var = "SEARCHAPI_API_KEY" if provider == "searchapi" else "SERPAPI_API_KEY"
        api_key = os.environ.get(env_var, "")
    if not api_key:
        raise FlightSearchError(
            f"No API key for {provider}. Set the environment variable or pass api_key explicitly."
        )

    params: dict[str, Any] = {
        "engine": "google_hotels",
        "q": q,
        "check_in_date": check_in_date,
        "check_out_date": check_out_date,
        "adults": adults,
        "hl": "en",
        "currency": "USD",
        "api_key": api_key,
    }
    if children:
        params["children"] = children

    try:
        response = requests.get(PROVIDER_ENDPOINTS[provider], params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as e:
        raise FlightSearchError(f"Failed to reach {provider}: {e}") from e
    except ValueError as e:
        raise FlightSearchError(f"{provider} returned a non-JSON response: {e}") from e

    if "error" in data:
        raise FlightSearchError(f"{provider} error: {data['error']}")
    return data


def extract_hotels(data: dict) -> list[dict]:
    """Returns the property list from a raw Google Hotels payload."""
    return list(data.get("properties", []))


def hotel_price_per_night(hotel: dict) -> Optional[float]:
    """Best-effort numeric nightly rate from a property record."""
    return hotel.get("rate_per_night", {}).get("extracted_lowest")


def filter_hotels(
    hotels: list[dict],
    min_rating: Optional[float] = None,
    max_price_per_night: Optional[float] = None,
    min_hotel_class: Optional[int] = None,
) -> list[dict]:
    """Client-side filtering of Google Hotels properties."""
    out = []
    for h in hotels:
        if min_rating and (h.get("overall_rating") or 0) < min_rating:
            continue
        price = hotel_price_per_night(h)
        if max_price_per_night and price is not None and price > max_price_per_night:
            continue
        if min_hotel_class and (h.get("extracted_hotel_class") or h.get("hotel_class") or 0) and \
                int(h.get("extracted_hotel_class") or 0) < min_hotel_class:
            continue
        out.append(h)
    return out


def rank_hotels(hotels: list[dict], sort_by: str = "value") -> list[dict]:
    """Sorts properties by 'price', 'rating', or a blended 'value' score."""
    if sort_by == "price":
        return sorted(hotels, key=lambda h: hotel_price_per_night(h) or 10**6)
    if sort_by == "rating":
        return sorted(hotels, key=lambda h: -(h.get("overall_rating") or 0))

    priced = [hotel_price_per_night(h) or 10**6 for h in hotels]
    if not priced:
        return hotels
    lo, hi = min(priced), max(priced)
    rng = (hi - lo) or 1.0

    def value_score(h: dict) -> float:
        price_norm = ((hotel_price_per_night(h) or 10**6) - lo) / rng
        rating_norm = (h.get("overall_rating") or 0) / 5.0
        return 0.5 * price_norm - 0.5 * rating_norm

    return sorted(hotels, key=value_score)


def summarize_hotels_for_llm(search_params: dict, data: dict, top_n: int = 5) -> str:
    """Condenses a raw hotels payload into a short string for the agent."""
    hotels = extract_hotels(data)
    if not hotels:
        return f"No hotels found for '{search_params.get('q')}' ({search_params.get('check_in_date')})."

    lines = [
        f"Hotels for '{search_params.get('q')}', "
        f"{search_params.get('check_in_date')} to {search_params.get('check_out_date')}:"
    ]
    for h in rank_hotels(hotels, "value")[:top_n]:
        price = hotel_price_per_night(h)
        total = h.get("total_rate", {}).get("extracted_lowest")
        lines.append(
            f"  - {h.get('name', '?')}: ${price or '?'}/night"
            + (f" (${total} total)" if total else "")
            + f", rating {h.get('overall_rating', '?')}/5 ({h.get('reviews', 0)} reviews)"
            + (f", {h.get('extracted_hotel_class')}-star" if h.get("extracted_hotel_class") else "")
            + (f" [Link: {h['link']}]" if h.get("link") else "")
        )
    return "\n".join(lines)


# Backwards-compatible alias (pre-hotels name)
FlightAgent = TravelAgent

"""
🧭 FareScout — flight + hotel search UI over the shared travel_search module.

Run with:
    streamlit run streamlit_app.py

API keys come from Streamlit secrets or environment variables (SEARCHAPI_API_KEY /
SERPAPI_API_KEY / OPENAI_API_KEY) or can be pasted in the sidebar. Never hardcode keys.
"""

import datetime
import json
import os
from pathlib import Path

import streamlit as st

from airports import AIRPORT_LABELS, LABEL_TO_CODE, label_for
from travel_search import (
    TRAVEL_CLASSES,
    FlightSearchError,
    TravelAgent,
    booking_link,
    extract_flights,
    extract_hotels,
    filter_flights,
    filter_hotels,
    format_minutes_to_hm,
    hotel_price_per_night,
    rank_flights,
    rank_hotels,
    search_flights,
    search_hotels,
)

st.set_page_config(page_title="FareScout", page_icon="🧭", layout="wide")

SAMPLE_DATA_PATH = Path(__file__).parent / "sample_flights.json"
SAMPLE_HOTELS_PATH = Path(__file__).parent / "sample_hotels.json"


_SECRETS_PATHS = (
    Path.home() / ".streamlit" / "secrets.toml",
    Path(__file__).parent / ".streamlit" / "secrets.toml",
)


def get_secret(name: str) -> str:
    """Reads a key from Streamlit secrets (cloud) or the environment (local).

    Touching st.secrets with no secrets.toml prints a UI warning, so only
    read it when a secrets file actually exists.
    """
    value = ""
    if any(p.exists() for p in _SECRETS_PATHS):
        try:
            value = st.secrets.get(name, "")
        except Exception:
            value = ""
    return value or os.environ.get(name, "")

STOP_OPTIONS = {
    "Any": "any",
    "Nonstop only": "nonstop",
    "1 stop or fewer": "one_stop_or_fewer",
    "2 stops or fewer": "two_stops_or_fewer",
}

SORT_PRESETS = {
    "Best value (balanced)": dict(weight_price=0.5, weight_duration=0.4, weight_carbon=0.1),
    "Cheapest first": dict(weight_price=1.0, weight_duration=0.0, weight_carbon=0.0),
    "Fastest first": dict(weight_price=0.0, weight_duration=1.0, weight_carbon=0.0),
    "Greenest first": dict(weight_price=0.0, weight_duration=0.0, weight_carbon=1.0),
}


# --------------------------- Sidebar: settings ---------------------------

with st.sidebar:
    st.header("⚙️ Settings")

    demo_mode = st.toggle(
        "Demo mode (sample data)",
        value=not (get_secret("SEARCHAPI_API_KEY") or get_secret("SERPAPI_API_KEY")),
        help="Renders bundled sample results without calling any API. Great for trying the UI.",
    )

    provider = st.selectbox("Travel data provider", ["searchapi", "serpapi"], disabled=demo_mode)
    env_key = get_secret("SEARCHAPI_API_KEY" if provider == "searchapi" else "SERPAPI_API_KEY")
    search_key = st.text_input(
        f"{provider} API key",
        value=env_key,
        type="password",
        disabled=demo_mode,
        help="Loaded from the environment when set; paste one here otherwise.",
    )

    st.divider()
    st.subheader("🤖 AI agent")
    openai_key = st.text_input(
        "OpenAI API key",
        value=get_secret("OPENAI_API_KEY"),
        type="password",
        help="Only needed for the AI Agent tab.",
    )
    agent_model = st.selectbox(
        "Model",
        ["gpt-5-mini", "gpt-5", "gpt-4.1", "gpt-4o-mini"],
        help="gpt-5-mini is the default: strong tool-calling at a fraction of gpt-5's price.",
    )


# --------------------------- Result rendering ---------------------------

def render_flight_card(option: dict, rank: int, link: str | None) -> None:
    price = option.get("price")
    total = option.get("total_duration", 0)
    layovers = option.get("layovers", [])
    legs = option.get("flights", [])
    carbon = option.get("carbon_emissions", {})

    airlines = ", ".join(dict.fromkeys(leg.get("airline", "?") for leg in legs))
    stops_txt = "Nonstop" if not layovers else f"{len(layovers)} stop(s)"

    with st.container(border=True):
        head_l, head_r = st.columns([4, 1])
        with head_l:
            logo = option.get("airline_logo")
            title = f"#{rank} · {airlines}"
            if logo:
                st.markdown(
                    f'<img src="{logo}" height="26" style="vertical-align:middle;margin-right:8px">'
                    f"<b>{title}</b>",
                    unsafe_allow_html=True,
                )
            else:
                st.markdown(f"**{title}**")
            st.caption(f"{stops_txt} · {format_minutes_to_hm(total)} total")
        with head_r:
            st.metric("Price", f"${price:,}" if isinstance(price, (int, float)) else "N/A")

        if carbon:
            kg = carbon.get("this_flight", 0) / 1000
            diff = carbon.get("difference_percent")
            diff_txt = f" ({diff:+d}% vs typical)" if isinstance(diff, int) else ""
            st.caption(f"🌱 Carbon: {kg:,.0f} kg CO₂e{diff_txt}")

        with st.expander("Itinerary details"):
            for leg in legs:
                dep, arr = leg["departure_airport"], leg["arrival_airport"]
                try:
                    dep_t = datetime.datetime.strptime(dep["time"], "%Y-%m-%d %H:%M").strftime("%b %d, %H:%M")
                    arr_t = datetime.datetime.strptime(arr["time"], "%Y-%m-%d %H:%M").strftime("%b %d, %H:%M")
                except (KeyError, ValueError):
                    dep_t, arr_t = dep.get("time", "?"), arr.get("time", "?")
                st.markdown(
                    f"**{leg.get('flight_number', '')} · {leg.get('airline', '')} ({leg.get('airplane', '')})**\n"
                    f"- 🛫 {dep.get('name', '?')} ({dep.get('id', '?')}) — {dep_t}\n"
                    f"- 🛬 {arr.get('name', '?')} ({arr.get('id', '?')}) — {arr_t}\n"
                    f"- ⏱ {format_minutes_to_hm(leg.get('duration', 0))}"
                    + (f" · 💺 {leg['legroom']}" if leg.get("legroom") else "")
                )
                if leg.get("extensions"):
                    st.caption(" · ".join(leg["extensions"]))
            for lay in layovers:
                st.info(f"Layover at {lay.get('name', '?')} — {format_minutes_to_hm(lay.get('duration', 0))}", icon="🕐")

        if link:
            st.link_button("🔗 Book on Google Flights", link)


def render_hotel_card(hotel: dict, rank: int) -> None:
    name = hotel.get("name", "Unknown property")
    rating = hotel.get("overall_rating")
    reviews = hotel.get("reviews")
    stars = hotel.get("extracted_hotel_class")
    price = hotel_price_per_night(hotel)
    total = hotel.get("total_rate", {}).get("extracted_lowest")

    with st.container(border=True):
        head_l, head_r = st.columns([4, 1])
        with head_l:
            st.markdown(f"**#{rank} · {name}**" + (f" · {'⭐' * int(stars)}" if stars else ""))
            bits = []
            if rating:
                bits.append(f"{rating}/5" + (f" ({reviews:,} reviews)" if reviews else ""))
            if hotel.get("check_in_time"):
                bits.append(f"check-in {hotel['check_in_time']}")
            if bits:
                st.caption(" · ".join(bits))
        with head_r:
            st.metric("Per night", f"${price:,.0f}" if price else "N/A")
            if total:
                st.caption(f"${total:,.0f} total")

        if hotel.get("amenities"):
            st.caption(" · ".join(hotel["amenities"][:8]))
        if hotel.get("link"):
            st.link_button("🔗 View / book", hotel["link"])


@st.cache_data(ttl=600, show_spinner=False)
def cached_search(**kwargs) -> dict:
    return search_flights(**kwargs)


@st.cache_data(ttl=600, show_spinner=False)
def cached_hotel_search(**kwargs) -> dict:
    return search_hotels(**kwargs)


# --------------------------- Tabs ---------------------------

st.title("🧭 FareScout")
st.caption("Scouting the best fares — flights, hotels, and complete trips.")
tab_search, tab_hotels, tab_agent = st.tabs(["✈️ Flights", "🏨 Hotels", "🤖 AI Agent"])


with tab_search:
    with st.form("search_form"):
        c1, c2, c3 = st.columns([2, 2, 2])
        with c1:
            from_label = st.selectbox(
                "From",
                AIRPORT_LABELS,
                index=AIRPORT_LABELS.index(label_for("SAN")),
                help="Type a city name to search the list.",
            )
        with c2:
            to_label = st.selectbox(
                "To",
                AIRPORT_LABELS,
                index=AIRPORT_LABELS.index(label_for("CDG")),
                help="Type a city name to search the list.",
            )
        from_city = LABEL_TO_CODE[from_label]
        to_city = LABEL_TO_CODE[to_label]
        with c3:
            trip_type = st.radio("Trip", ["Round trip", "One way"], horizontal=True)

        c4, c5, c6 = st.columns(3)
        today = datetime.date.today()
        with c4:
            depart = st.date_input("Departure date", today + datetime.timedelta(days=30), min_value=today)
        with c5:
            ret = st.date_input("Return date", today + datetime.timedelta(days=37), min_value=today)
        with c6:
            travel_class = st.selectbox(
                "Class", TRAVEL_CLASSES, format_func=lambda c: c.replace("_", " ").title()
            )

        c7, c8, c9, c10 = st.columns(4)
        with c7:
            adults = st.number_input("Adults", 1, 9, 1)
        with c8:
            children = st.number_input("Children", 0, 9, 0)
        with c9:
            infants = st.number_input("Infants (lap)", 0, 4, 0)
        with c10:
            stops_label = st.selectbox("Stops", list(STOP_OPTIONS))

        with st.expander("More filters"):
            f1, f2 = st.columns(2)
            with f1:
                max_duration_h = st.slider("Max total duration (hours)", 2, 40, 24)
                max_price = st.number_input("Max price (USD, 0 = no limit)", 0, 20000, 0, step=100)
            with f2:
                exclude_aircraft = st.multiselect(
                    "Exclude aircraft", ["737MAX", "787", "777", "A380", "A320", "CRJ", "E175"]
                )
                sort_by = st.selectbox("Sort results by", list(SORT_PRESETS))
                top_n = st.slider("Show top N results", 1, 10, 5)

        st.caption("Airport not in the list? The 🤖 AI Agent tab understands any city or airport name.")
        submitted = st.form_submit_button("Search flights", type="primary", use_container_width=True)

    if submitted:
        if trip_type == "Round trip" and ret <= depart:
            st.error("Return date must be after the departure date.")
        elif from_city == to_city:
            st.error("Departure and arrival airports must be different.")
        else:
            try:
                if demo_mode:
                    data = json.loads(SAMPLE_DATA_PATH.read_text())
                    st.info("Demo mode is on — showing bundled sample results.", icon="🧪")
                else:
                    with st.spinner("Searching flights…"):
                        data = cached_search(
                            departure_id=from_city,
                            arrival_id=to_city,
                            outbound_date=depart.strftime("%Y-%m-%d"),
                            return_date=ret.strftime("%Y-%m-%d") if trip_type == "Round trip" else None,
                            travel_class=travel_class,
                            adults=int(adults),
                            children=int(children),
                            infants_on_lap=int(infants),
                            stops=STOP_OPTIONS[stops_label],
                            provider=provider,
                            api_key=search_key or None,
                        )

                flights = filter_flights(
                    extract_flights(data),
                    max_duration_minutes=max_duration_h * 60,
                    exclude_aircraft=exclude_aircraft,
                    max_price=max_price or None,
                )
                if not flights:
                    st.warning("No flights matched your filters. Try relaxing the duration, price, or aircraft filters.")
                else:
                    ranked = rank_flights(flights, **SORT_PRESETS[sort_by])[:top_n]
                    link = booking_link(data)
                    st.subheader(f"{len(ranked)} option(s) · sorted by {sort_by.lower()}")
                    for i, option in enumerate(ranked, 1):
                        render_flight_card(option, i, link)
            except FlightSearchError as e:
                st.error(f"Flight search failed: {e}")


with tab_hotels:
    with st.form("hotel_form"):
        h1, h2, h3 = st.columns([3, 2, 2])
        today = datetime.date.today()
        with h1:
            hotel_q = st.text_input("Destination", "Paris", help="City, neighborhood, or landmark — e.g. 'hotels near the Marais, Paris'")
        with h2:
            check_in = st.date_input("Check-in", today + datetime.timedelta(days=30), min_value=today)
        with h3:
            check_out = st.date_input("Check-out", today + datetime.timedelta(days=33), min_value=today)

        h4, h5, h6, h7 = st.columns(4)
        with h4:
            h_adults = st.number_input("Adults", 1, 8, 2, key="hotel_adults")
        with h5:
            h_children = st.number_input("Children", 0, 8, 0, key="hotel_children")
        with h6:
            min_rating = st.select_slider("Min guest rating", [0.0, 3.0, 3.5, 4.0, 4.5], value=4.0)
        with h7:
            max_night = st.number_input("Max $/night (0 = no limit)", 0, 5000, 0, step=25)

        h8, h9 = st.columns(2)
        with h8:
            hotel_sort = st.selectbox("Sort by", ["Best value", "Lowest price", "Best rating"])
        with h9:
            hotel_top_n = st.slider("Show top N hotels", 1, 15, 8)

        hotels_submitted = st.form_submit_button("Search hotels", type="primary", use_container_width=True)

    if hotels_submitted:
        if check_out <= check_in:
            st.error("Check-out must be after check-in.")
        elif not hotel_q.strip():
            st.error("Enter a destination.")
        else:
            try:
                if demo_mode:
                    hotel_data = json.loads(SAMPLE_HOTELS_PATH.read_text())
                    st.info("Demo mode is on — showing bundled sample results.", icon="🧪")
                else:
                    with st.spinner("Searching hotels…"):
                        hotel_data = cached_hotel_search(
                            q=hotel_q,
                            check_in_date=check_in.strftime("%Y-%m-%d"),
                            check_out_date=check_out.strftime("%Y-%m-%d"),
                            adults=int(h_adults),
                            children=int(h_children),
                            provider=provider,
                            api_key=search_key or None,
                        )

                hotels = filter_hotels(
                    extract_hotels(hotel_data),
                    min_rating=min_rating or None,
                    max_price_per_night=max_night or None,
                )
                if not hotels:
                    st.warning("No hotels matched your filters. Try lowering the rating floor or raising the price cap.")
                else:
                    sort_key = {"Best value": "value", "Lowest price": "price", "Best rating": "rating"}[hotel_sort]
                    ranked = rank_hotels(hotels, sort_key)[:hotel_top_n]
                    st.subheader(f"{len(ranked)} propert{'y' if len(ranked) == 1 else 'ies'} · sorted by {hotel_sort.lower()}")
                    for i, h in enumerate(ranked, 1):
                        render_hotel_card(h, i)
            except FlightSearchError as e:
                st.error(f"Hotel search failed: {e}")


with tab_agent:
    st.markdown(
        "Describe a trip in plain language — the agent decomposes complex queries "
        "(flexible dates, multiple airports, mixed cabin classes, hotels, budgets) "
        "into individual searches and synthesizes a complete trip."
    )
    st.caption(
        'Example: "LAX or SAN to Madrid Dec 13–15 in business, return Jan 2–4 in '
        'economy, plus a 4-star hotel near the city center under $250/night — '
        'flights and hotel under $10,000 total."'
    )

    if "agent_chat" not in st.session_state:
        st.session_state.agent_chat = []

    for role, content in st.session_state.agent_chat:
        with st.chat_message(role):
            st.markdown(content)

    query = st.chat_input("Where do you want to go?")
    if query:
        st.session_state.agent_chat.append(("user", query))
        with st.chat_message("user"):
            st.markdown(query)

        if demo_mode:
            answer = (
                "🧪 Demo mode is on, so I can't run live searches. Turn off demo mode in the "
                "sidebar and add a search API key + OpenAI key to use the agent."
            )
            with st.chat_message("assistant"):
                st.markdown(answer)
            st.session_state.agent_chat.append(("assistant", answer))
        elif not openai_key:
            st.error("Add your OpenAI API key in the sidebar to use the AI agent.")
        elif not search_key:
            st.error(f"Add your {provider} API key in the sidebar so the agent can search flights.")
        else:
            with st.chat_message("assistant"):
                status = st.status("Planning searches…", expanded=True)

                def on_event(kind: str, text: str) -> None:
                    if kind == "thinking":
                        status.markdown(f"💭 {text}")
                    elif kind == "tool_call":
                        status.markdown(f"🛠️ Searching **{text}**")
                    elif kind == "tool_result":
                        status.markdown(f"```\n{text}\n```")

                try:
                    agent = TravelAgent(
                        model=agent_model,
                        provider=provider,
                        search_api_key=search_key,
                        openai_api_key=openai_key,
                        on_event=on_event,
                    )
                    answer = agent.run(query)
                    status.update(label="Done", state="complete", expanded=False)
                    st.markdown(answer)
                    st.session_state.agent_chat.append(("assistant", answer))
                except Exception as e:
                    status.update(label="Failed", state="error")
                    st.error(f"Agent failed: {e}")

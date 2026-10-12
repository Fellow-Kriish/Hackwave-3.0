// Harbor & Pine V1: the hotel's original, simpler booking page. Same rooms, rates and reservation records as V2 and V3,
// so a goal written for one version means the same thing on the others. Reservations are saved in this browser under
// the same key the later versions use.
(() => {
  "use strict";
  const STORAGE_KEY = "harbor-pine-data";
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

  const rooms = [
    { id: "coast-room", name: "Coastal King", type: "Room", price: 149, capacity: 2, description: "A calm, light-filled room with natural textures." },
    { id: "garden-room", name: "Garden Twin", type: "Room", price: 129, capacity: 2, description: "A relaxed retreat with soft colors and thoughtful comforts." },
    { id: "harbor-suite", name: "Harbor Suite", type: "Suite", price: 229, capacity: 3, description: "A generous suite with views toward the water." },
    { id: "pine-suite", name: "Pine Family Suite", type: "Suite", price: 269, capacity: 5, description: "Space for the whole crew, with flexible sleeping." },
    { id: "studio-room", name: "Quiet Studio", type: "Room", price: 119, capacity: 2, description: "A smaller, considered space for a solo trip or two." },
    { id: "signature-suite", name: "Signature Suite", type: "Suite", price: 319, capacity: 4, description: "Our most spacious stay, with a deep soaking tub." }
  ];

  const freshState = () => ({ reservations: [], qaHistory: [], nextBooking: 2001 });

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed) return freshState();
      return {
        reservations: Array.isArray(parsed.reservations) ? parsed.reservations.filter((item) => item && typeof item.bookingNumber === "string").slice(0, 100) : [],
        qaHistory: Array.isArray(parsed.qaHistory) ? parsed.qaHistory.slice(0, 100) : [],
        nextBooking: Number.isInteger(parsed.nextBooking) ? parsed.nextBooking : 2001
      };
    } catch {
      return freshState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  let state = loadState();
  let selectedRoom = null;

  // A local date as YYYY-MM-DD, without a UTC shift.
  function localDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function getNights(checkin, checkout) {
    return Math.round((new Date(`${checkout}T00:00:00`) - new Date(`${checkin}T00:00:00`)) / 86400000);
  }

  function showStatus(message) {
    $("app-status").textContent = message;
  }

  function initializeDates() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);
    $("checkin").min = localDateString(today);
    $("checkin").value = localDateString(tomorrow);
    $("checkout").min = localDateString(dayAfter);
    $("checkout").value = localDateString(dayAfter);
  }

  $("checkin").addEventListener("change", () => {
    const checkin = $("checkin").value;
    if (!checkin) return;
    const minimum = new Date(`${checkin}T00:00:00`);
    minimum.setDate(minimum.getDate() + 1);
    $("checkout").min = localDateString(minimum);
    if (!$("checkout").value || $("checkout").value <= checkin) $("checkout").value = localDateString(minimum);
  });

  function renderRooms(guests) {
    const list = $("room-list");
    list.replaceChildren();
    const results = rooms.filter((room) => room.capacity >= guests);
    $("result-count").textContent = `${results.length} room(s) available`;

    if (results.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No rooms fit this many guests.";
      list.appendChild(empty);
      return;
    }

    results.forEach((room) => {
      const card = document.createElement("article");
      card.className = "hotel-card";
      card.dataset.roomId = room.id;
      card.setAttribute("aria-label", room.name);

      const art = document.createElement("div");
      art.className = "hotel-art";
      art.setAttribute("aria-hidden", "true");
      art.textContent = room.type;

      const name = document.createElement("h3");
      name.textContent = room.name;

      const capacity = document.createElement("p");
      capacity.className = "hotel-location";
      capacity.textContent = `${room.type} · up to ${room.capacity} guests`;

      const description = document.createElement("p");
      description.textContent = room.description;

      const price = document.createElement("p");
      price.className = "hotel-price";
      price.textContent = money(room.price);
      const note = document.createElement("small");
      note.textContent = " / night";
      price.appendChild(note);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "button primary";
      button.textContent = "Book This Room";
      button.dataset.testid = `book-room-${room.id}`;
      button.addEventListener("click", () => selectRoom(room.id));

      card.append(art, name, capacity, description, price, button);
      list.appendChild(card);
    });
  }

  $("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const checkin = $("checkin").value;
    const checkout = $("checkout").value;
    const guests = Number($("guests").value);
    const message = $("search-message");
    message.className = "message";

    if (!checkin || !checkout) {
      message.textContent = "Please choose both dates.";
      message.classList.add("error");
      return;
    }
    if (checkin < localDateString(new Date())) {
      message.textContent = "Check-in cannot be in the past.";
      message.classList.add("error");
      return;
    }
    const nights = getNights(checkin, checkout);
    if (nights < 1) {
      message.textContent = "Check-out must be at least one day after check-in.";
      message.classList.add("error");
      return;
    }

    selectedRoom = null;
    $("booking").hidden = true;
    $("booking-message").hidden = true;
    renderRooms(guests);
    message.textContent = `Showing rooms for ${nights} night(s), ${guests} guest(s).`;
    showStatus("Room search completed.");
  });

  function selectRoom(roomId) {
    selectedRoom = rooms.find((room) => room.id === roomId) || null;
    if (!selectedRoom) return;
    const nights = getNights($("checkin").value, $("checkout").value);
    if (nights < 1) {
      $("search-message").textContent = "Please select valid dates first.";
      $("search-message").classList.add("error");
      return;
    }

    const summary = $("booking-summary");
    summary.replaceChildren();
    [
      `${selectedRoom.name} (${selectedRoom.type})`,
      `Check-in: ${$("checkin").value}`,
      `Check-out: ${$("checkout").value}`,
      `Guests: ${$("guests").value}`,
      `Duration: ${nights} night(s)`,
      `Rate: ${money(selectedRoom.price)} per night`,
      `Estimated total: ${money(selectedRoom.price * nights)}`
    ].forEach((text, index, all) => {
      const line = document.createElement("p");
      line.textContent = text;
      if (index === all.length - 1) line.style.fontWeight = "bold";
      summary.appendChild(line);
    });

    $("booking").hidden = false;
    $("booking-message").hidden = true;
    showStatus("Room selected. Awaiting guest details.");
    $("booking").scrollIntoView({ behavior: "smooth" });
  }

  $("booking-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const result = $("booking-message");
    result.className = "confirmation";
    const name = $("guest-name").value.trim();
    const email = $("guest-email").value.trim();
    const phone = $("guest-phone").value.trim();

    if (!selectedRoom) {
      result.textContent = "Please select a room before booking.";
      result.classList.add("error");
      result.hidden = false;
      return;
    }
    if (name.length < 2 || !email || !/^[0-9]{10}$/.test(phone)) {
      result.textContent = "Please provide a valid name, email, and 10-digit phone number.";
      result.classList.add("error");
      result.hidden = false;
      return;
    }

    const checkIn = $("checkin").value;
    const checkOut = $("checkout").value;
    const nights = getNights(checkIn, checkOut);
    const booking = {
      bookingNumber: String(state.nextBooking++),
      createdAt: new Date().toISOString(),
      roomId: selectedRoom.id,
      roomName: selectedRoom.name,
      checkIn,
      checkOut,
      nights,
      guests: Number($("guests").value),
      guest: { name, email, phone, requests: "" },
      total: selectedRoom.price * nights,
      status: "Confirmed (demo)"
    };

    state.reservations.unshift(booking);
    state.reservations = state.reservations.slice(0, 100);
    saveState();

    result.textContent = `Reservation #${booking.bookingNumber} is confirmed for ${name}: ${booking.roomName}, ${checkIn} to ${checkOut}. Total ${money(booking.total)}. This is a demo reservation; no payment was taken.`;
    result.hidden = false;
    showStatus(`Demo reservation ${booking.bookingNumber} completed.`);
  });

  initializeDates();
  renderRooms(Number($("guests").value));
})();

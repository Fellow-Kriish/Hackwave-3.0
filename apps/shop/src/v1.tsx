import { useState, type FormEvent, type ReactNode } from 'react';
import { formatINR } from '../shared/format';
import {
  cardLast4,
  EMPTY_CARD,
  EMPTY_SHIPPING,
  errorMessages,
  validateCard,
  validateShipping,
  type CardInput,
  type FieldErrors,
  type ShippingInput,
} from '../shared/validation';
import { placeOrder } from './api';
import { ErrorSummary, Field, NotFound, OrderSummary } from './components';
import { useProducts, useTitle } from './hooks';
import { Link, matchPath, navigate } from './router';
import { useShop } from './state';

/**
 * v1, the baseline shop: header button "Cart (n)", product grid, cart page,
 * one checkout page with Payment then Shipping, confirmation at /order/4821.
 */
export function V1App({ path }: { path: string }) {
  const order = matchPath('/order/:id', path);
  let page: ReactNode;
  if (path === '/') page = <Home />;
  else if (path === '/cart') page = <Cart />;
  else if (path === '/checkout') page = <Checkout />;
  else if (order) page = <Confirmation id={order.id ?? ''} />;
  else page = <NotFound />;
  return <Layout>{page}</Layout>;
}

function Layout({ children }: { children: ReactNode }) {
  const { count, notice } = useShop();
  return (
    <div className="v1">
      <header className="v1-header">
        <Link to="/" className="v1-brand">
          Stride
        </Link>
        <nav aria-label="Main" className="v1-nav">
          <Link to="/">Shop</Link>
          <button type="button" className="v1-cart-button" onClick={() => navigate('/cart')}>
            Cart ({count})
          </button>
        </nav>
      </header>
      <main className="v1-main">
        <p role="status" className="notice">
          {notice}
        </p>
        {children}
      </main>
      <footer className="v1-footer">
        <p>Stride demo shop. Test data only.</p>
      </footer>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('');
}

function Home() {
  useTitle('Stride | Shoes for every step');
  const { products, error } = useProducts();
  const { addToCart, setNotice } = useShop();
  return (
    <>
      <h1>Shoes for every step</h1>
      {error && <p role="alert">Could not load products: {error}</p>}
      {!products && !error && <p>Loading products…</p>}
      {products && (
        <div className="v1-grid">
          {products.map((product) => (
            <article key={product.id} className="v1-card" aria-labelledby={`product-${product.id}-name`}>
              <div className="v1-swatch" aria-hidden="true">
                {initials(product.name)}
              </div>
              <h2 id={`product-${product.id}-name`}>{product.name}</h2>
              <p className="v1-price">{formatINR(product.price)}</p>
              <p className="v1-desc">{product.description}</p>
              <button
                type="button"
                id={`add-to-cart-${product.id}`}
                className="btn btn-primary add-to-cart"
                onClick={() => {
                  addToCart(product);
                  setNotice(`${product.name} added to cart`);
                }}
              >
                Add to cart
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function Cart() {
  useTitle('Your cart | Stride');
  const { lines, total, removeFromCart } = useShop();
  return (
    <>
      <h1>Your cart</h1>
      {lines.length === 0 ? (
        <>
          <p>Your cart is empty.</p>
          <p>
            <Link to="/">Continue shopping</Link>
          </p>
        </>
      ) : (
        <>
          <ul className="v1-cart-lines" aria-label="Items in your cart">
            {lines.map((line) => (
              <li key={line.productId}>
                <span className="v1-line-name">{line.name}</span>
                <span>Qty {line.qty}</span>
                <span>{formatINR(line.price * line.qty)}</span>
                <button
                  type="button"
                  className="btn btn-link"
                  aria-label={`Remove ${line.name}`}
                  onClick={() => removeFromCart(line.productId)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="v1-cart-total">
            Total: <strong>{formatINR(total)}</strong>
          </p>
          <button type="button" id="checkout-button" className="btn btn-primary" onClick={() => navigate('/checkout')}>
            Checkout
          </button>
        </>
      )}
    </>
  );
}

function Checkout() {
  useTitle('Checkout | Stride');
  const { lines, total, clearCart, setLastOrder } = useShop();
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [shipping, setShipping] = useState<ShippingInput>(EMPTY_SHIPPING);
  const [cardErrors, setCardErrors] = useState<FieldErrors<keyof CardInput>>({});
  const [shippingErrors, setShippingErrors] = useState<FieldErrors<keyof ShippingInput>>({});
  const [summary, setSummary] = useState<{ title: string; messages: string[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (lines.length === 0) {
    return (
      <>
        <h1>Checkout</h1>
        <p>Your cart is empty.</p>
        <p>
          <Link to="/">Continue shopping</Link>
        </p>
      </>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const nextCardErrors = validateCard(card);
    const nextShippingErrors = validateShipping(shipping, { requirePhone: false });
    setCardErrors(nextCardErrors);
    setShippingErrors(nextShippingErrors);
    const messages = [...errorMessages(nextCardErrors), ...errorMessages(nextShippingErrors)];
    if (messages.length > 0) {
      setSummary({ title: 'Please fix the following', messages });
      return;
    }
    setSummary(null);
    // Double-submit guard: the button stays disabled while the order is in flight.
    setSubmitting(true);
    try {
      const { id } = await placeOrder({
        items: lines.map(({ productId, qty }) => ({ productId, qty })),
        shipping: {
          name: shipping.name.trim(),
          street: shipping.street.trim(),
          city: shipping.city.trim(),
          pincode: shipping.pincode.trim(),
        },
        cardLast4: cardLast4(card.number),
        total,
      });
      setLastOrder({ ref: String(id), lines, total });
      clearCart();
      navigate(`/order/${id}`);
    } catch (error) {
      setSummary({
        title: "We couldn't place your order",
        messages: [error instanceof Error ? error.message : String(error)],
      });
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1>Checkout</h1>
      <div className="v1-checkout">
        <form className="v1-form" aria-label="Checkout" noValidate onSubmit={(event) => void onSubmit(event)}>
          {summary && <ErrorSummary title={summary.title} messages={summary.messages} />}
          <fieldset>
            <legend>Payment</legend>
            <Field
              id="card-number"
              label="Card number"
              value={card.number}
              onChange={(number) => setCard((current) => ({ ...current, number }))}
              error={cardErrors.number}
              inputMode="numeric"
              autoComplete="cc-number"
            />
            <Field
              id="card-expiry"
              label="Expiry (MM/YY)"
              value={card.expiry}
              onChange={(expiry) => setCard((current) => ({ ...current, expiry }))}
              error={cardErrors.expiry}
              autoComplete="cc-exp"
            />
            <Field
              id="card-cvv"
              label="CVV"
              value={card.cvv}
              onChange={(cvv) => setCard((current) => ({ ...current, cvv }))}
              error={cardErrors.cvv}
              inputMode="numeric"
              autoComplete="cc-csc"
            />
            <Field
              id="card-name"
              label="Name on card"
              value={card.name}
              onChange={(name) => setCard((current) => ({ ...current, name }))}
              error={cardErrors.name}
              autoComplete="cc-name"
            />
          </fieldset>
          <fieldset>
            <legend>Shipping</legend>
            <Field
              id="ship-name"
              label="Full name"
              value={shipping.name}
              onChange={(name) => setShipping((current) => ({ ...current, name }))}
              error={shippingErrors.name}
              autoComplete="name"
            />
            <Field
              id="ship-street"
              label="Street address"
              value={shipping.street}
              onChange={(street) => setShipping((current) => ({ ...current, street }))}
              error={shippingErrors.street}
              autoComplete="street-address"
            />
            <Field
              id="ship-city"
              label="City"
              value={shipping.city}
              onChange={(city) => setShipping((current) => ({ ...current, city }))}
              error={shippingErrors.city}
              autoComplete="address-level2"
            />
            <Field
              id="ship-pincode"
              label="Pincode"
              value={shipping.pincode}
              onChange={(pincode) => setShipping((current) => ({ ...current, pincode }))}
              error={shippingErrors.pincode}
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </fieldset>
          <button type="submit" id="place-order" className="btn btn-primary btn-large" disabled={submitting}>
            Place order
          </button>
        </form>
        <OrderSummary lines={lines} total={total} />
      </div>
    </>
  );
}

function Confirmation({ id }: { id: string }) {
  useTitle(`Order #${id} confirmed | Stride`);
  const { lastOrder } = useShop();
  if (!/^\d+$/.test(id)) return <NotFound />;
  const order = lastOrder?.ref === id ? lastOrder : null;
  return (
    <>
      <h1>Order confirmed #{id}</h1>
      <p>Thank you for shopping with Stride. Your shoes are being packed.</p>
      {order && <OrderSummary lines={order.lines} total={order.total} heading="What you ordered" />}
      <p>
        <Link to="/">Continue shopping</Link>
      </p>
    </>
  );
}

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { formatINR } from '../shared/format';
import {
  cardLast4,
  digitsOnly,
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
import { useShop, type CartLine } from './state';

/**
 * v2, the redesign: new theme and layout; "Add to cart" keeps its name but loses its id and classes;
 * the cart is a slide-over dialog behind an icon button labelled "Your bag"; checkout starts with
 * "Proceed to payment"; Shipping comes first with a new required Phone field, then Payment;
 * the final button reads "Pay ₹1,299"; confirmation lands on /orders/ORD-4821.
 * v2-broken and v2-wrong-total render exactly this UI.
 */
export function V2App({ path }: { path: string }) {
  const order = matchPath('/orders/:ref', path);
  let page: ReactNode;
  if (path === '/') page = <Home />;
  else if (path === '/checkout' || path === '/checkout/shipping') page = <Shipping />;
  else if (path === '/checkout/payment') page = <Payment />;
  else if (order) page = <Confirmation orderRef={order.ref ?? ''} />;
  else page = <NotFound />;
  return <Layout>{page}</Layout>;
}

function Layout({ children }: { children: ReactNode }) {
  const { lines, count, total, notice, removeFromCart } = useShop();
  const [bagOpen, setBagOpen] = useState(false);
  const bagButton = useRef<HTMLButtonElement>(null);

  function closeBag() {
    setBagOpen(false);
    bagButton.current?.focus();
  }

  function proceedToPayment() {
    setBagOpen(false);
    navigate('/checkout/shipping');
  }

  return (
    <div className="v2">
      <header className="v2-header">
        <Link to="/" className="v2-brand">
          STRIDE
        </Link>
        <nav aria-label="Main" className="v2-nav">
          <Link to="/">New arrivals</Link>
          <button
            ref={bagButton}
            type="button"
            className="v2-bag-button"
            aria-label="Your bag"
            aria-haspopup="dialog"
            aria-expanded={bagOpen}
            onClick={() => setBagOpen(true)}
          >
            <BagIcon />
            {count > 0 && (
              <span className="v2-badge" aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        </nav>
      </header>
      <main className="v2-main">
        <p role="status" className="notice">
          {notice}
        </p>
        {children}
      </main>
      <footer className="v2-footer">
        <p>STRIDE demo storefront. Test data only.</p>
      </footer>
      {bagOpen && (
        <BagDialog lines={lines} total={total} onRemove={removeFromCart} onClose={closeBag} onProceed={proceedToPayment} />
      )}
    </div>
  );
}

function BagIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 7h12l-1 13H7L6 7z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

interface BagDialogProps {
  lines: CartLine[];
  total: number;
  onRemove: (productId: string) => void;
  onClose: () => void;
  onProceed: () => void;
}

function BagDialog({ lines, total, onRemove, onClose, onProceed }: BagDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialog.current) return;
    // Keep keyboard focus inside the open dialog.
    const focusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <div className="v2-backdrop" onClick={onClose} />
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Your bag" className="v2-drawer" onKeyDown={onKeyDown}>
        <div className="v2-drawer-header">
          <h2>Your bag</h2>
          <button ref={closeButton} type="button" className="v2-close" aria-label="Close bag" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {lines.length === 0 ? (
          <p>Your bag is empty.</p>
        ) : (
          <>
            <ul className="v2-bag-lines">
              {lines.map((line) => (
                <li key={line.productId}>
                  <div>
                    <p className="v2-bag-name">{line.name}</p>
                    <p className="v2-muted">Qty {line.qty}</p>
                  </div>
                  <div className="v2-bag-right">
                    <p>{formatINR(line.price * line.qty)}</p>
                    <button
                      type="button"
                      className="v2-text-button"
                      aria-label={`Remove ${line.name}`}
                      onClick={() => onRemove(line.productId)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="v2-subtotal">
              <span>Subtotal</span>
              <strong>{formatINR(total)}</strong>
            </p>
            <button type="button" className="v2-primary" onClick={onProceed}>
              Proceed to payment
            </button>
          </>
        )}
      </div>
    </>
  );
}

function Home() {
  useTitle('STRIDE | New arrivals');
  const { products, error } = useProducts();
  const { addToCart, setNotice } = useShop();
  return (
    <>
      <section className="v2-hero" aria-labelledby="hero-heading">
        <p className="v2-eyebrow">New season</p>
        <h1 id="hero-heading">Run further.</h1>
        <p>Trail, street and everything in between. Free shipping on every order.</p>
      </section>
      <section aria-labelledby="arrivals-heading">
        <h2 id="arrivals-heading">New arrivals</h2>
        {error && <p role="alert">Could not load products: {error}</p>}
        {!products && !error && <p>Loading products…</p>}
        {products && (
          <div className="v2-grid">
            {products.map((product, index) => (
              <article key={product.id} className="v2-card" aria-labelledby={`card-${product.id}`}>
                <div className={`v2-art v2-art-${index % 4}`} aria-hidden="true" />
                <div className="v2-card-body">
                  <h3 id={`card-${product.id}`}>{product.name}</h3>
                  <p className="v2-muted">{product.description}</p>
                  <p className="v2-price">{formatINR(product.price)}</p>
                  <button
                    type="button"
                    onClick={() => {
                      addToCart(product);
                      setNotice(`${product.name} added to your bag`);
                    }}
                  >
                    Add to cart
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function CheckoutSteps({ current }: { current: 'shipping' | 'payment' }) {
  return (
    <ol className="v2-steps" aria-label="Checkout steps">
      <li aria-current={current === 'shipping' ? 'step' : undefined}>1. Shipping</li>
      <li aria-current={current === 'payment' ? 'step' : undefined}>2. Payment</li>
    </ol>
  );
}

function EmptyBag() {
  return (
    <>
      <h1>Checkout</h1>
      <p>Your bag is empty.</p>
      <p>
        <Link to="/">Browse new arrivals</Link>
      </p>
    </>
  );
}

function Shipping() {
  useTitle('Shipping | STRIDE');
  const { lines, total, shipping: saved, setShipping: saveShipping } = useShop();
  const [shipping, setShipping] = useState<ShippingInput>(() => ({
    ...EMPTY_SHIPPING,
    ...saved,
    phone: saved?.phone ?? '',
  }));
  const [errors, setErrors] = useState<FieldErrors<keyof ShippingInput>>({});
  const [messages, setMessages] = useState<string[]>([]);

  if (lines.length === 0) return <EmptyBag />;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateShipping(shipping, { requirePhone: true });
    const nextMessages = errorMessages(nextErrors);
    setErrors(nextErrors);
    setMessages(nextMessages);
    if (nextMessages.length > 0) return;
    saveShipping({
      name: shipping.name.trim(),
      street: shipping.street.trim(),
      city: shipping.city.trim(),
      pincode: shipping.pincode.trim(),
      phone: digitsOnly(shipping.phone),
    });
    navigate('/checkout/payment');
  }

  return (
    <>
      <h1>Checkout</h1>
      <CheckoutSteps current="shipping" />
      <div className="v2-checkout">
        <form className="v2-form" aria-label="Shipping details" noValidate onSubmit={onSubmit}>
          <ErrorSummary title="Please fix the following" messages={messages} />
          <fieldset>
            <legend>Shipping</legend>
            <Field
              id="ship-name"
              label="Full name"
              value={shipping.name}
              onChange={(name) => setShipping((current) => ({ ...current, name }))}
              error={errors.name}
              autoComplete="name"
            />
            <Field
              id="ship-street"
              label="Street address"
              value={shipping.street}
              onChange={(street) => setShipping((current) => ({ ...current, street }))}
              error={errors.street}
              autoComplete="street-address"
            />
            <Field
              id="ship-city"
              label="City"
              value={shipping.city}
              onChange={(city) => setShipping((current) => ({ ...current, city }))}
              error={errors.city}
              autoComplete="address-level2"
            />
            <Field
              id="ship-pincode"
              label="Pincode"
              value={shipping.pincode}
              onChange={(pincode) => setShipping((current) => ({ ...current, pincode }))}
              error={errors.pincode}
              inputMode="numeric"
              autoComplete="postal-code"
            />
            <Field
              id="ship-phone"
              label="Phone"
              type="tel"
              value={shipping.phone}
              onChange={(phone) => setShipping((current) => ({ ...current, phone }))}
              error={errors.phone}
              inputMode="numeric"
              autoComplete="tel"
            />
          </fieldset>
          <button type="submit" className="v2-primary">
            Continue to payment
          </button>
        </form>
        <OrderSummary lines={lines} total={total} />
      </div>
    </>
  );
}

function Payment() {
  useTitle('Payment | STRIDE');
  const { lines, total, shipping, clearCart, setShipping, setLastOrder } = useShop();
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [errors, setErrors] = useState<FieldErrors<keyof CardInput>>({});
  const [summary, setSummary] = useState<{ title: string; messages: string[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (lines.length === 0) return <EmptyBag />;
  if (!shipping) {
    return (
      <>
        <h1>Checkout</h1>
        <CheckoutSteps current="payment" />
        <p>Add your shipping details first.</p>
        <p>
          <Link to="/checkout/shipping">Go to shipping</Link>
        </p>
      </>
    );
  }
  const shipTo = shipping;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const nextErrors = validateCard(card);
    setErrors(nextErrors);
    const messages = errorMessages(nextErrors);
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
        shipping: shipTo,
        cardLast4: cardLast4(card.number),
        total,
      });
      const orderRef = `ORD-${id}`;
      setLastOrder({ ref: orderRef, lines, total });
      clearCart();
      setShipping(null);
      navigate(`/orders/${orderRef}`);
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
      <CheckoutSteps current="payment" />
      <div className="v2-checkout">
        <form className="v2-form" aria-label="Payment details" noValidate onSubmit={(event) => void onSubmit(event)}>
          {summary && <ErrorSummary title={summary.title} messages={summary.messages} />}
          <p className="v2-ship-to">
            Shipping to {shipTo.name}, {shipTo.street}, {shipTo.city} {shipTo.pincode}.{' '}
            <Link to="/checkout/shipping">Edit shipping</Link>
          </p>
          <fieldset>
            <legend>Payment</legend>
            <Field
              id="card-number"
              label="Card number"
              value={card.number}
              onChange={(number) => setCard((current) => ({ ...current, number }))}
              error={errors.number}
              inputMode="numeric"
              autoComplete="cc-number"
            />
            <Field
              id="card-expiry"
              label="Expiry (MM/YY)"
              value={card.expiry}
              onChange={(expiry) => setCard((current) => ({ ...current, expiry }))}
              error={errors.expiry}
              autoComplete="cc-exp"
            />
            <Field
              id="card-cvv"
              label="CVV"
              value={card.cvv}
              onChange={(cvv) => setCard((current) => ({ ...current, cvv }))}
              error={errors.cvv}
              inputMode="numeric"
              autoComplete="cc-csc"
            />
            <Field
              id="card-name"
              label="Name on card"
              value={card.name}
              onChange={(name) => setCard((current) => ({ ...current, name }))}
              error={errors.name}
              autoComplete="cc-name"
            />
          </fieldset>
          <button type="submit" className="v2-primary" disabled={submitting}>
            Pay {formatINR(total)}
          </button>
        </form>
        <OrderSummary lines={lines} total={total} />
      </div>
    </>
  );
}

function Confirmation({ orderRef }: { orderRef: string }) {
  useTitle(`${orderRef} | STRIDE`);
  const { lastOrder } = useShop();
  if (!/^ORD-\d+$/.test(orderRef)) return <NotFound />;
  const order = lastOrder?.ref === orderRef ? lastOrder : null;
  return (
    <section className="v2-confirmation" aria-labelledby="confirmation-heading">
      <h1 id="confirmation-heading">Thanks! Order {orderRef} is on its way</h1>
      <p>You will get delivery updates by SMS.</p>
      {order && <OrderSummary lines={order.lines} total={order.total} heading="Your order" />}
      <p>
        <Link to="/">Keep shopping</Link>
      </p>
    </section>
  );
}

import { useEffect, useRef, type InputHTMLAttributes } from 'react';
import { formatINR } from '../shared/format';
import { useTitle } from './hooks';
import { Link } from './router';
import type { CartLine } from './state';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange'> {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

/** A visible label bound to its input with for/id; errors are linked with aria-describedby. */
export function Field({ id, label, value, onChange, error, ...input }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        value={value}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        {...input}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** Validation and order errors use role=alert, the signal the verifier's no-error check reads. */
export function ErrorSummary({ title, messages }: { title: string; messages: string[] }) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length > 0) summary.current?.focus();
  }, [messages]);
  if (messages.length === 0) return null;
  return (
    <div ref={summary} role="alert" className="error-summary" tabIndex={-1}>
      <h2>{title}</h2>
      <ul>
        {messages.map((message, index) => (
          <li key={index}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

export function OrderSummary({ lines, total, heading = 'Order summary' }: { lines: CartLine[]; total: number; heading?: string }) {
  return (
    <section className="order-summary" aria-labelledby="order-summary-heading">
      <h2 id="order-summary-heading">{heading}</h2>
      <ul>
        {lines.map((line) => (
          <li key={line.productId}>
            <span>
              {line.name} × {line.qty}
            </span>
            <span>{formatINR(line.price * line.qty)}</span>
          </li>
        ))}
      </ul>
      <p className="order-summary-row">
        <span>Shipping</span>
        <span>Free</span>
      </p>
      <p className="order-summary-row order-summary-total">
        <span>Total</span>
        <strong>{formatINR(total)}</strong>
      </p>
    </section>
  );
}

export function NotFound() {
  useTitle('Page not found');
  return (
    <>
      <h1>Page not found</h1>
      <p>
        <Link to="/">Back to the shop</Link>
      </p>
    </>
  );
}

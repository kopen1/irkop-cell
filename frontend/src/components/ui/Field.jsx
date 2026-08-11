import { cloneElement, isValidElement, useId } from 'react';

export function Field({ label, error, hint, required, children, className = '' }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children, { id, ...(error ? { 'aria-invalid': true } : {}) })
    : children;

  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {control}
      {error ? (
        <span className="field-error" role="alert">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input(props) {
  return <input className="input" {...props} />;
}

export function Select({ children, ...props }) {
  return (
    <select className="select" {...props}>
      {children}
    </select>
  );
}

export function Textarea(props) {
  return <textarea className="textarea" {...props} />;
}
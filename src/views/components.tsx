import type { Child, FC } from "hono/jsx";
import { CSRF_FIELD } from "../lib/csrf-field";
import type { DefectStatus, Severity, VehicleStatus } from "../labels";
import { defectStatusLabel, severityLabel, vehicleStatusLabel } from "../labels";

export const Csrf: FC<{ token: string }> = ({ token }) => <input type="hidden" name={CSRF_FIELD} value={token} />;

export const H1: FC<{ children?: Child; sub?: string | undefined }> = ({ children, sub }) => (
  <div class="mb-5">
    <h1 class="text-2xl font-bold tracking-tight">{children}</h1>
    {sub ? <p class="mt-1 text-gray-600">{sub}</p> : null}
  </div>
);

export const Card: FC<{ children?: Child; class?: string; id?: string }> = (props) => (
  <section
    id={props.id}
    class={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5 ${props.class ?? ""}`}
  >
    {props.children}
  </section>
);

export const H2: FC<{ children?: Child }> = ({ children }) => <h2 class="mb-3 text-lg font-semibold">{children}</h2>;

type Tone = "info" | "success" | "error" | "warning";
const toneClass: Record<Tone, string> = {
  info: "border-primary-200 bg-primary-50 text-ink",
  success: "border-success-200 bg-success-50 text-success",
  error: "border-danger-200 bg-danger-50 text-danger",
  warning: "border-alert-200 bg-alert-50 text-ink",
};

export const Alert: FC<{ tone?: Tone; children?: Child; id?: string }> = ({ tone = "info", children, id }) => (
  <div
    id={id}
    role={tone === "error" ? "alert" : "status"}
    class={`mb-4 rounded-xl border px-4 py-3 text-sm ${toneClass[tone]}`}
  >
    {children}
  </div>
);

interface FieldProps {
  label: string;
  name: string;
  type?: string;
  value?: string | number | null | undefined;
  required?: boolean;
  autocomplete?: string;
  inputmode?: "numeric" | "email" | "text";
  hint?: string;
  maxlength?: number;
  min?: number;
  pattern?: string;
  placeholder?: string;
  id?: string;
}

export const Field: FC<FieldProps> = (p) => {
  const id = p.id ?? `f-${p.name}`;
  return (
    <div class="mb-4">
      <label for={id} class="mb-1 block text-sm font-medium">
        {p.label}
        {p.required ? null : <span class="font-normal text-gray-500"> (optional)</span>}
      </label>
      <input
        id={id}
        name={p.name}
        type={p.type ?? "text"}
        value={p.value === null || p.value === undefined ? "" : String(p.value)}
        required={p.required}
        autocomplete={p.autocomplete}
        inputmode={p.inputmode}
        maxlength={p.maxlength}
        min={p.min}
        pattern={p.pattern}
        placeholder={p.placeholder}
        aria-describedby={p.hint ? `${id}-hint` : undefined}
        class="block w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200"
      />
      {p.hint ? (
        <p id={`${id}-hint`} class="mt-1 text-sm text-gray-600">
          {p.hint}
        </p>
      ) : null}
    </div>
  );
};

export const TextArea: FC<{
  label: string;
  name: string;
  value?: string;
  maxlength: number;
  rows?: number;
  required?: boolean;
  hint?: string;
  id?: string;
}> = (p) => {
  const id = p.id ?? `f-${p.name}`;
  return (
    <div class="mb-4">
      <label for={id} class="mb-1 block text-sm font-medium">
        {p.label}
        {p.required ? null : <span class="font-normal text-gray-500"> (optional)</span>}
      </label>
      <textarea
        id={id}
        name={p.name}
        rows={p.rows ?? 3}
        maxlength={p.maxlength}
        required={p.required}
        aria-describedby={p.hint ? `${id}-hint` : undefined}
        class="block w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-200"
      >
        {p.value ?? ""}
      </textarea>
      {p.hint ? (
        <p id={`${id}-hint`} class="mt-1 text-sm text-gray-600">
          {p.hint}
        </p>
      ) : null}
    </div>
  );
};

type ButtonKind = "primary" | "secondary" | "danger" | "ghost";
const buttonClass: Record<ButtonKind, string> = {
  primary: "bg-primary text-white hover:bg-primary-dark",
  secondary: "border border-gray-300 bg-white text-ink hover:bg-gray-50",
  danger: "border border-danger-200 bg-white text-danger hover:bg-danger-50",
  ghost: "text-primary hover:bg-primary-50",
};

export const btn = (kind: ButtonKind = "primary", extra = "") =>
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-60 ${buttonClass[kind]} ${extra}`;

export const Button: FC<{
  kind?: ButtonKind;
  children?: Child;
  type?: "submit" | "button";
  name?: string;
  value?: string;
  class?: string;
  full?: boolean;
  confirm?: string;
}> = (p) => (
  <button
    type={p.type ?? "submit"}
    name={p.name}
    value={p.value}
    data-confirm={p.confirm}
    class={btn(p.kind, `${p.full ? "w-full" : ""} ${p.class ?? ""}`)}
  >
    {p.children}
  </button>
);

const severityTone: Record<Severity, string> = {
  minor: "bg-gray-100 text-gray-800",
  major: "bg-alert-100 text-ink",
  critical: "bg-danger text-white",
};
export const SeverityBadge: FC<{ severity: Severity }> = ({ severity }) => (
  <span class={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${severityTone[severity]}`}>
    {severityLabel[severity]}
  </span>
);

const statusTone: Record<DefectStatus, string> = {
  open: "bg-danger-50 text-danger",
  in_progress: "bg-primary-100 text-primary",
  fixed: "bg-success-50 text-success",
};
export const DefectStatusBadge: FC<{ status: DefectStatus }> = ({ status }) => (
  <span class={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusTone[status]}`}>
    {defectStatusLabel[status]}
  </span>
);

export const VehicleStatusBadge: FC<{ status: VehicleStatus }> = ({ status }) => (
  <span
    class={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${status === "in_service" ? "bg-success-50 text-success" : "bg-danger text-white"}`}
  >
    {vehicleStatusLabel[status]}
  </span>
);

export const PassBadge: FC<{ passed: boolean }> = ({ passed }) => (
  <span
    class={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${passed ? "bg-success-50 text-success" : "bg-danger-50 text-danger"}`}
  >
    {passed ? "Passed" : "Failed"}
  </span>
);

export const Empty: FC<{ children?: Child }> = ({ children }) => (
  <div class="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-gray-600">{children}</div>
);

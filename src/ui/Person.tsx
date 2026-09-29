// A person, drawn as the andamio-coach world draws people: a head over shoulders.
// Agents are people in this app. Outlined by default; `solid` for the one a view is about.

export function Person({ solid = false }: { solid?: boolean }) {
  const fill = solid ? "currentColor" : "none";
  return (
    <svg className="person" viewBox="0 0 18 20" aria-hidden="true">
      <circle cx="9" cy="5.5" r="4.25" fill={fill} stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.75 19.25v-1.5a7.25 7.25 0 0 1 14.5 0v1.5z" fill={fill} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

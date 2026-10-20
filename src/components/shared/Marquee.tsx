export function Marquee({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={`marquee ${className}`}>
      <span className="marquee-fit" aria-hidden>
        {text}
      </span>
      <span className="marquee-view">
        <span>{text}</span>
      </span>
    </span>
  );
}

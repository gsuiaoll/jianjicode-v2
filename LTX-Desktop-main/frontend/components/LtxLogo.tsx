interface JianjiCodeLogoProps {
  className?: string
}

export function JianjiCodeLogo({ className = "h-6" }: JianjiCodeLogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 160 32"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
    >
      {/* Play/Edit triangle icon */}
      <path
        d="M8 4.5L22 16L8 27.5Z"
        fill="currentColor"
        fillOpacity="0.9"
      />
      {/* Geometric bracket frame */}
      <rect
        x="28" y="3" width="5" height="26" rx="2"
        fill="currentColor"
      />
      <rect
        x="38" y="3" width="5" height="26" rx="2"
        fill="currentColor"
        fillOpacity="0.7"
      />
      <rect
        x="48" y="3" width="5" height="26" rx="2"
        fill="currentColor"
        fillOpacity="0.45"
      />
      {/* Brand name text (SVG path based) */}
      <text
        x="60" y="24"
        fill="currentColor"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="18"
        fontWeight="700"
        letterSpacing="0.5"
      >
        JianJiCode
      </text>
    </svg>
  )
}

/** Keep backward-compatible alias */
export const LtxLogo = JianjiCodeLogo

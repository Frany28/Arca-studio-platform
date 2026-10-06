import { useState } from "react";
import ReactCountryFlag from "react-country-flag";

function normalizeCountryCode(countryCode) {
  return String(countryCode ?? "").trim().toUpperCase();
}

function Flag({
  countryCode,
  size = "var(--size-flag)",
  title,
  className,
  style,
  imgStyle,
  useSvg = true,
  cdnUrl,
  cdnSuffix,
  loading,
  onError,
  ...flagProps
}) {
  const resolvedCountryCode = normalizeCountryCode(countryCode);
  const svgSourceKey = [
    resolvedCountryCode,
    useSvg ? "svg" : "fallback",
    cdnUrl || "",
    cdnSuffix || "",
  ].join("|");
  const [failedSvgSourceKey, setFailedSvgSourceKey] = useState("");

  if (!resolvedCountryCode) {
    return null;
  }

  const shouldUseSvg = useSvg && failedSvgSourceKey !== svgSourceKey;
  const fallbackLabel = resolvedCountryCode.slice(0, 2);

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
        borderRadius: "9999px",
        ...style,
      }}
    >
      {shouldUseSvg ? (
        <ReactCountryFlag
          countryCode={resolvedCountryCode}
          svg
          title={title}
          aria-label={title ?? resolvedCountryCode}
          {...(cdnUrl ? { cdnUrl } : {})}
          {...(cdnSuffix ? { cdnSuffix } : {})}
          {...(loading ? { loading } : {})}
          onError={(event) => {
            setFailedSvgSourceKey(svgSourceKey);
            onError?.(event);
          }}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "cover",
            ...imgStyle,
          }}
          {...flagProps}
        />
      ) : (
        <span
          role="img"
          title={title}
          aria-label={title ?? resolvedCountryCode}
          style={{
            width: "100%",
            height: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "inherit",
            backgroundColor: "var(--color-neutral-200)",
            color: "var(--color-text-300)",
            fontSize: "9px",
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "0px",
            ...imgStyle,
          }}
          {...flagProps}
        >
          {fallbackLabel}
        </span>
      )}
    </span>
  );
}

export default Flag;

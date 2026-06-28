"use client";

import dynamic from "next/dynamic";

// ssr:false needs to live in a client component in Next 16+
const CityMap = dynamic(() => import("./CityMap"), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl overflow-hidden border border-buzz-border grid place-items-center text-buzz-mute" style={{ height: "70vh", minHeight: 480 }}>
      Loading map…
    </div>
  ),
});

export default CityMap;

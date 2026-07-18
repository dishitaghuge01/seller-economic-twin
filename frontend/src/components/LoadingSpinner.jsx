import { useEffect, useState } from "react";

export default function LoadingSpinner({ messages = ["Loading..."], heightClass = "h-64" }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((v) => (v + 1) % messages.length);
    }, 900);
    return () => window.clearInterval(id);
  }, [messages.length]);

  return (
    <div className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 ${heightClass} flex flex-col items-center justify-center`}>
      <div className="animate-spin h-8 w-8 border-2 border-gray-300 border-t-gray-800 rounded-full" />
      <p className="mt-3 text-xs text-gray-500">{messages[index]}</p>
    </div>
  );
}

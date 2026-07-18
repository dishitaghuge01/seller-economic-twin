export default function TypingIndicator() {
  return (
    <div className="flex justify-start mb-2">
      <div className="max-w-[85%] flex flex-col items-start">
        <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-white text-gray-900 shadow-sm">
          <div className="flex items-center gap-1.5 py-1">
            <span
              className="h-2.5 w-2.5 rounded-full bg-gray-400 animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="h-2.5 w-2.5 rounded-full bg-gray-400 animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="h-2.5 w-2.5 rounded-full bg-gray-400 animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

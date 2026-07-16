// src/test/setup.js
import "@testing-library/jest-dom";

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

if (!globalThis.ResizeObserver) {
	globalThis.ResizeObserver = ResizeObserverMock;
}

if (typeof window !== "undefined" && window.localStorage) {
	Object.defineProperty(globalThis, "localStorage", {
		value: window.localStorage,
		configurable: true,
	});
} else {
	const memoryStorage = new Map();
	Object.defineProperty(globalThis, "localStorage", {
		value: {
			getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
			setItem: (key, value) => memoryStorage.set(key, String(value)),
			removeItem: (key) => memoryStorage.delete(key),
			clear: () => memoryStorage.clear(),
			key: (index) => Array.from(memoryStorage.keys())[index] ?? null,
			get length() {
				return memoryStorage.size;
			},
		},
		configurable: true,
	});
}
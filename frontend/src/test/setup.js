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
import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught an error", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-red-800">Something went wrong loading this page.</p>
          <button
            onClick={this.handleReload}
            className="mt-4 rounded-full bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

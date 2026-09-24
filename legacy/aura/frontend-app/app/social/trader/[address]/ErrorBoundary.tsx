"use client";
import React from "react";
export class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return <div style={{padding: "20px", color: "red", background: "black", whiteSpace: "pre-wrap"}}>{this.state.error?.stack}</div>;
    }
    return this.props.children;
  }
}

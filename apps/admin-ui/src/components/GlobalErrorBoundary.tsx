import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

export default class GlobalErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // ponytail: console here (not logger pkg) — boundary catches renderer crashes before app logger may exist
    console.error('Unhandled render error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: undefined });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="Error"
          subTitle={this.state.message}
          extra={
            <Button type="primary" onClick={this.handleRetry}>
              Reload
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}

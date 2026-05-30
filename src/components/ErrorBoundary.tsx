import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /**
   * Optional label shown in the error box heading.
   * Defaults to "Something went wrong".
   */
  label?: string
  /**
   * When true the boundary renders a compact inline error bar instead of a
   * full-page overlay. Useful for scoped regions (e.g. results section).
   */
  inline?: boolean
}

type State = {
  error: Error | null
  info: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
    console.error('[ErrorBoundary] Caught render error:', error, info)
  }

  handleReset = () => {
    this.setState({ error: null, info: null })
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    const { label = 'Something went wrong', inline } = this.props
    const stack = info?.componentStack ?? ''

    if (inline) {
      return (
        <div className="error-boundary-inline">
          <strong>{label}:</strong>{' '}
          <span className="muted">{error.message}</span>
          <button
            type="button"
            className="btn btn-secondary btn-tiny"
            style={{ marginLeft: '0.5rem' }}
            onClick={this.handleReset}
          >
            Retry
          </button>
        </div>
      )
    }

    return (
      <div className="error-boundary-page">
        <div className="error-boundary-box">
          <h2 className="error-boundary-title">⚠ {label}</h2>
          <p className="error-boundary-message">{error.message}</p>
          {stack && (
            <details className="error-boundary-details">
              <summary className="muted tiny">Component stack</summary>
              <pre className="error-boundary-stack">{stack.trim()}</pre>
            </details>
          )}
          <div className="error-boundary-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={this.handleReset}
            >
              Try to recover
            </button>
          </div>
        </div>
      </div>
    )
  }
}

import { OptionalAppFrame } from '@/components/layout/OptionalAppFrame';

// The common ancestor remains mounted across app, public discovery and map
// navigations. Each protected child still performs its own account gate.
export default function SharedShellLayout({ children }) {
  return <OptionalAppFrame>{children}</OptionalAppFrame>;
}

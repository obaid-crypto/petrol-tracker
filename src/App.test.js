import { render, screen } from '@testing-library/react';
import App from './App';

test('renders petrol tracker heading', () => {
  render(<App />);
  const headingElement = screen.getByRole('heading', { name: /petrol tracker/i });
  expect(headingElement).toBeInTheDocument();
});

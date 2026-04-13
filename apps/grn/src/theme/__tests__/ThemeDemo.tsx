/**
 * Theme Demo Component
 *
 * Visual demonstration of Tailwind CSS integration with theme tokens.
 * This component shows various theme tokens in action.
 */

export function ThemeDemo() {
  return (
    <div className="p-8 space-y-8 bg-neutral-50">
      <h1 className="text-4xl font-bold text-neutral-900">Theme Integration Demo</h1>

      {/* Color Palette */}
      <section>
        <h2 className="text-2xl font-semibold text-neutral-800 mb-4">Colors</h2>
        <div className="grid grid-cols-5 gap-4">
          <div className="space-y-2">
            <div className="h-16 bg-primary-500 rounded-lg shadow-md"></div>
            <p className="text-sm text-neutral-600">Primary</p>
          </div>
          <div className="space-y-2">
            <div className="h-16 bg-success rounded-lg shadow-md"></div>
            <p className="text-sm text-neutral-600">Success</p>
          </div>
          <div className="space-y-2">
            <div className="h-16 bg-warning rounded-lg shadow-md"></div>
            <p className="text-sm text-neutral-600">Warning</p>
          </div>
          <div className="space-y-2">
            <div className="h-16 bg-error rounded-lg shadow-md"></div>
            <p className="text-sm text-neutral-600">Error</p>
          </div>
          <div className="space-y-2">
            <div className="h-16 bg-info rounded-lg shadow-md"></div>
            <p className="text-sm text-neutral-600">Info</p>
          </div>
        </div>
      </section>

      {/* Shadows */}
      <section>
        <h2 className="text-2xl font-semibold text-neutral-800 mb-4">Shadows (Semi-Flat Design)</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="h-24 bg-white rounded-lg shadow-sm flex items-center justify-center">
            <p className="text-sm text-neutral-600">sm</p>
          </div>
          <div className="h-24 bg-white rounded-lg shadow-base flex items-center justify-center">
            <p className="text-sm text-neutral-600">base</p>
          </div>
          <div className="h-24 bg-white rounded-lg shadow-md flex items-center justify-center">
            <p className="text-sm text-neutral-600">md</p>
          </div>
          <div className="h-24 bg-white rounded-lg shadow-lg flex items-center justify-center">
            <p className="text-sm text-neutral-600">lg</p>
          </div>
        </div>
      </section>

      {/* Border Radius */}
      <section>
        <h2 className="text-2xl font-semibold text-neutral-800 mb-4">Border Radius</h2>
        <div className="grid grid-cols-5 gap-4">
          <div className="h-16 bg-primary-500 rounded-sm"></div>
          <div className="h-16 bg-primary-500 rounded-base"></div>
          <div className="h-16 bg-primary-500 rounded-md"></div>
          <div className="h-16 bg-primary-500 rounded-lg"></div>
          <div className="h-16 bg-primary-500 rounded-xl"></div>
        </div>
        <div className="grid grid-cols-5 gap-4 mt-2">
          <p className="text-sm text-neutral-600 text-center">sm</p>
          <p className="text-sm text-neutral-600 text-center">base</p>
          <p className="text-sm text-neutral-600 text-center">md</p>
          <p className="text-sm text-neutral-600 text-center">lg</p>
          <p className="text-sm text-neutral-600 text-center">xl</p>
        </div>
      </section>

      {/* Transitions */}
      <section>
        <h2 className="text-2xl font-semibold text-neutral-800 mb-4">Transitions</h2>
        <div className="grid grid-cols-3 gap-4">
          <button className="h-16 bg-primary-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-fast hover:scale-105">
            Fast (150ms)
          </button>
          <button className="h-16 bg-primary-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-base hover:scale-105">
            Base (200ms)
          </button>
          <button className="h-16 bg-primary-500 text-white rounded-lg shadow-md hover:shadow-lg transition-all duration-slow hover:scale-105">
            Slow (300ms)
          </button>
        </div>
      </section>
    </div>
  );
}

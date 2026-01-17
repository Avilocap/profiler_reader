# React Profiler Visualizer

A web-based tool to analyze and compare React DevTools profiler exports. Easily identify performance bottlenecks, excessive re-renders, and measure the impact of your optimizations.

## Features

- **Side-by-side comparison**: Load before/after profiler exports to see the impact of your optimizations
- **Component render analysis**: See which components render the most and their total duration
- **Re-render causes**: Identify what triggers re-renders (hooks, props, state, context, mount)
- **Component hierarchy**: Click on any component to see its full path in the React tree
- **Timeline visualization**: Compare commit durations over time between versions
- **Performance metrics**: Total renders, commits, duration, and percentage improvements

## Usage

1. Open `visualizer.html` in your browser
2. Export profiler data from React DevTools (Profiler tab → Export)
3. Drag and drop your JSON files:
   - **Before (Non-optimized)**: Your baseline profiler export
   - **After (Optimized)**: Your optimized profiler export
4. Navigate through the tabs to analyze your data

## Tabs

| Tab | Description |
|-----|-------------|
| **Summary** | Overview metrics, commit duration chart, and global re-render causes |
| **Components** | Top components by render count with before/after comparison |
| **Re-renders** | Detailed breakdown of what causes each component to re-render |
| **Timeline** | Visual comparison of commit durations over time |
| **Comparison** | Component-by-component improvement/regression table |

## Component Hierarchy

In the Components tab, click on any component name (marked with ▶) to expand and see its full path in the React component tree. This helps you identify exactly where a component lives in your application.

## Requirements

- A modern web browser (Chrome, Firefox, Safari, Edge)
- React DevTools profiler exports (JSON format)

## License

MIT

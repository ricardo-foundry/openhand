# Weather Plugin for OpenHand

A simple weather plugin demonstrating the OpenHand plugin system.

## Installation

```bash
# Copy to plugins directory
cp -r plugins/weather ~/.openhand/plugins/

# Or install via CLI
openhand plugin install weather
```

## Usage

```
User: What's the weather like in Shanghai?
AI: [Uses weather_current tool]

User: Show me the forecast for the next 5 days
AI: [Uses weather_forecast tool]
```

## Configuration

Set environment variable:
```bash
export WEATHER_API_KEY=your_api_key
```

## API

### weather_current
Get current weather for a city.

Parameters:
- `city` (string, optional): City name
- `units` (string, optional): "celsius" or "fahrenheit"

### weather_forecast
Get weather forecast.

Parameters:
- `city` (string, optional): City name
- `days` (number, optional): Number of days (default: 3)
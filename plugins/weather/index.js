// OpenHand Weather Plugin Example
// This demonstrates how to create a custom plugin

module.exports = {
  name: 'weather',
  version: '1.0.0',
  description: 'Get weather information',
  
  // Plugin configuration
  config: {
    apiKey: process.env.WEATHER_API_KEY,
    defaultCity: 'Beijing'
  },

  // Define tools provided by this plugin
  tools: [
    {
      name: 'weather_current',
      description: 'Get current weather for a city',
      parameters: [
        {
          name: 'city',
          type: 'string',
          description: 'City name',
          required: false,
          default: 'Beijing'
        },
        {
          name: 'units',
          type: 'string',
          description: 'Temperature units (celsius/fahrenheit)',
          required: false,
          default: 'celsius'
        }
      ],
      permissions: ['network:http'],
      sandboxRequired: false,
      
      // Tool execution function
      async execute(params, context) {
        const city = params.city || this.config.defaultCity;
        
        // In a real implementation, you would call a weather API
        // For demo purposes, return mock data
        return {
          city,
          temperature: 22,
          condition: 'Sunny',
          humidity: 45,
          windSpeed: 12,
          units: params.units || 'celsius'
        };
      }
    },
    {
      name: 'weather_forecast',
      description: 'Get weather forecast',
      parameters: [
        {
          name: 'city',
          type: 'string',
          description: 'City name',
          required: false
        },
        {
          name: 'days',
          type: 'number',
          description: 'Number of days',
          required: false,
          default: 3
        }
      ],
      permissions: ['network:http'],
      sandboxRequired: false,
      
      async execute(params, context) {
        const city = params.city || this.config.defaultCity;
        const days = params.days || 3;
        
        // Mock forecast data
        const forecast = [];
        for (let i = 0; i < days; i++) {
          forecast.push({
            day: new Date(Date.now() + i * 86400000).toLocaleDateString(),
            high: 25 - i,
            low: 15 - i,
            condition: i % 2 === 0 ? 'Sunny' : 'Cloudy'
          });
        }
        
        return { city, forecast };
      }
    }
  ],

  // Lifecycle hooks
  async onInstall() {
    console.log('Weather plugin installed');
  },

  async onUninstall() {
    console.log('Weather plugin uninstalled');
  },

  async onEnable() {
    console.log('Weather plugin enabled');
  },

  async onDisable() {
    console.log('Weather plugin disabled');
  }
};
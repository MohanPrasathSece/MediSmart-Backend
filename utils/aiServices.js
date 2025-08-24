const axios = require('axios');

// IBM Granite API for prescription processing
const processWithGranite = async (prompt) => {
  try {
    const response = await axios.post(
      process.env.IBM_GRANITE_API_URL || 'https://bam-api.res.ibm.com/v1/generate',
      {
        model_id: 'ibm/granite-3.3-8b-base',
        input: prompt,
        parameters: {
          decoding_method: 'greedy',
          max_new_tokens: 1000,
          temperature: 0.7,
          top_p: 0.9,
          repetition_penalty: 1.1
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.IBM_GRANITE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.results?.[0]?.generated_text || '';
  } catch (error) {
    console.error('IBM Granite API error:', error.response?.data || error.message);
    throw new Error('Failed to process with IBM Granite model');
  }
};

// OpenFDA API for drug safety
const checkDrugSafety = async (medicines, patientAge, conditions) => {
  try {
    const safetyChecks = await Promise.all(
      medicines.map(async (medicine) => {
        try {
          const response = await axios.get(
            `https://api.fda.gov/drug/label.json?search=openfda.brand_name:"${medicine}"&limit=1`
          );
          
          const drugData = response.data.results[0];
          return {
            medicine,
            warnings: drugData?.warnings || [],
            contraindications: drugData?.contraindications || [],
            interactions: drugData?.drug_interactions || []
          };
        } catch (error) {
          return { medicine, error: 'Drug information not found' };
        }
      })
    );

    return { safetyChecks };
  } catch (error) {
    throw new Error('Failed to check drug safety');
  }
};

// LibreTranslate API
const translateText = async (text, targetLang, sourceLang = 'auto') => {
  try {
    const response = await axios.post('https://libretranslate.de/translate', {
      q: text,
      source: sourceLang,
      target: targetLang,
      format: 'text'
    });

    return response.data.translatedText;
  } catch (error) {
    throw new Error('Failed to translate text');
  }
};

// Health query processing using IBM Granite
const processHealthQuery = async (query, context = {}) => {
  try {
    const healthKeywords = ['medicine', 'drug', 'side effect', 'dosage', 'treatment', 'prescription', 'pharmacy', 'medical', 'health'];
    const isHealthRelated = healthKeywords.some(keyword => 
      query.toLowerCase().includes(keyword)
    );

    if (!isHealthRelated) {
      return { 
        response: "I can only help with health-related queries about medicines, prescriptions, and general health information.", 
        confidence: 0.9 
      };
    }

    const granitePrompt = `
You are a helpful medical AI assistant for a medicine delivery platform. Provide accurate, helpful information about medicines, prescriptions, and general health topics.

Important Guidelines:
- Always recommend consulting healthcare professionals for medical advice
- Provide general information about medicines and health topics
- Do not diagnose medical conditions
- Be helpful but emphasize professional medical consultation

User Query: "${query}"
Context: ${JSON.stringify(context)}

Please provide a helpful, informative response:`;

    const graniteResponse = await processWithGranite(granitePrompt);
    
    return {
      response: graniteResponse || "I recommend consulting with a healthcare professional for specific medical advice.",
      confidence: graniteResponse ? 0.85 : 0.6,
      source: 'IBM Granite'
    };

  } catch (error) {
    console.error('Health query processing error:', error);
    return {
      response: "I'm currently unable to process your query. Please consult with a healthcare professional for medical advice.",
      confidence: 0.5,
      error: error.message
    };
  }
};

// Process prescription text with IBM Granite (standalone function)
const processPrescriptionWithGranite = async (prescriptionText) => {
  try {
    const prompt = `
Analyze this prescription text and extract structured information:

Prescription: "${prescriptionText}"

Extract and format as JSON:
{
  "medicines": [{"name": "", "dosage": "", "frequency": "", "duration": "", "instructions": ""}],
  "patient_info": {"name": "", "age": ""},
  "doctor_info": {"name": "", "clinic": ""},
  "warnings": [],
  "confidence": 0.85
}`;

    const response = await processWithGranite(prompt);
    
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (parseError) {
      console.warn('Failed to parse Granite JSON response:', parseError);
      return null;
    }
  } catch (error) {
    console.error('Granite prescription processing error:', error);
    return null;
  }
};

module.exports = {
  checkDrugSafety,
  translateText,
  processHealthQuery,
  processWithGranite,
  processPrescriptionWithGranite
};

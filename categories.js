/* Parishkar Purulia — Category Definitions (JavaScript Export)
   This is generated from categories.yaml. Do not edit by hand.
   Source of truth: categories.yaml (edit that file, then regenerate this one).
*/

window.KASA_CATEGORIES_CONFIG = {
  categories: {
    garbage: {
      key: 'garbage',
      en: 'Garbage',
      bn: 'বর্জ্য',
      hi: 'कचरा',
      emoji: '🗑️',
      photo: {
        required: true,
        hints: {
          en: [
            'Get close enough to see the detail',
            'Good light: morning or midday is best',
            "No people's faces, no number plates",
            'One photo per report'
          ],
          bn: [
            'বিস্তারিত দেখার মতো কাছ থেকে তুলুন',
            'ভালো আলো: সকাল বা দুপুর সেরা',
            'কোনো মুখ বা প্লেট নেই',
            'প্রতি রিপোর্টে এক ছবি'
          ],
          hi: [
            'विस्तार देखने के लिए काफी करीब से तस्वीर लें',
            'अच्छी रोशनी: सुबह या दोपहर सर्वश्रेष्ठ है',
            'कोई चेहरा या प्लेट नहीं',
            'प्रति रिपोर्ट एक तस्वीर'
          ]
        },
        max_size_kb: 200
      },
      questions: [
        {
          key: 'sub_type',
          order: 1,
          type: 'choice',
          en: 'What kind of garbage?',
          bn: 'কোন ধরনের বর্জ্য?',
          hi: 'किस तरह का कचरा?',
          options: [
            { key: 'household', en: 'Household', bn: 'গৃহস্থালী', hi: 'घरेलू' },
            { key: 'market', en: 'Market waste', bn: 'বাজার বর্জ্য', hi: 'बाजार कचरा' },
            { key: 'medical', en: 'Medical waste', bn: 'চিকিৎসা বর্জ্য', hi: 'चिकित्सा कचरा' },
            { key: 'construction', en: 'Construction debris', bn: 'নির্মাণ বর্জ্য', hi: 'निर्माण मलबा' }
          ]
        },
        {
          key: 'location_description',
          order: 2,
          type: 'open_text',
          max_length: 100,
          en: 'Where exactly? (street name, landmark)',
          bn: 'ঠিক কোথায়? (রাস্তার নাম, ল্যান্ডমার্ক)',
          hi: 'बिल्कुल कहाँ? (सड़क का नाम, स्थलचिह्न)',
          placeholder_en: 'Near the market, under the banyan tree'
        },
        {
          key: 'health_hazard',
          order: 3,
          type: 'yes_no',
          en: 'Is this a health hazard? (smell, insects, etc.)',
          bn: 'এটা স্বাস্থ্যঝুঁকি? (গন্ধ, পোকা, ইত্যাদি)',
          hi: 'क्या यह स्वास्थ्य जोखिम है? (गंध, कीड़े, आदि)'
        },
        {
          key: 'blocked_access',
          order: 4,
          type: 'yes_no',
          en: 'Does it block the road or path?',
          bn: 'এটা রাস্তা বা পথ বন্ধ করে?',
          hi: 'क्या यह सड़क या पथ को अवरुद्ध करता है?'
        },
        {
          key: 'cleanup_time',
          order: 5,
          type: 'choice',
          en: 'How long has this been here?',
          bn: 'এটা কতদিন ধরে আছে?',
          hi: 'यह कितने समय से यहाँ है?',
          options: [
            { key: 'less_24h', en: 'Less than 24 hours', bn: '२४ ঘণ্টার কম', hi: '२४ घंटे से कम' },
            { key: '1_7d', en: '1–7 days', bn: '१–७ दिन', hi: '१–७ दिन' },
            { key: 'more_7d', en: 'More than a week', bn: 'এक সপ্তাহের বেশি', hi: 'एक सप्ताह से अधिक' }
          ]
        },
        {
          key: 'consent',
          order: 6,
          type: 'yes_no',
          required: true,
          en: 'Confirm: this photo is true and you agree to our terms',
          bn: 'নিশ্চিত করুন: এই ছবি সত্য এবং আপনি আমাদের শর্ত সম্মত',
          hi: 'पुष्टि करें: यह फोटो सही है और आप हमारी शर्तों से सहमत हैं'
        }
      ],
      responsible_body: [
        {
          type: 'municipality',
          department: 'Sanitation/Conservancy',
          sla_hours: 24,
          escalation_path: [
            { level: 1, role: 'Ward Sanitation Inspector', escalate_if_breached_hours: 24 },
            { level: 2, role: 'Ward Chairman', escalate_if_breached_hours: 36 },
            { level: 3, role: 'Municipality Commissioner', escalate_if_breached_hours: 48 }
          ]
        },
        {
          type: 'gram_panchayat',
          department: 'Sanitation/Gram Panchayat',
          sla_hours: 48,
          escalation_path: [
            { level: 1, role: 'GP Secretary', escalate_if_breached_hours: 48 },
            { level: 2, role: 'GP Pradhan', escalate_if_breached_hours: 72 },
            { level: 3, role: 'BDO', escalate_if_breached_hours: 96 }
          ]
        }
      ],
      steward: {
        eligible_types: ['shop', 'market', 'restaurant', 'office'],
        can_adopt_radius_m: 50,
        responsibilities: {
          en: [
            'Keep the 50 m radius clean',
            'Report new garbage within 24 hours',
            'Photo evidence monthly'
          ],
          bn: [
            '५० मीटर ব্যাসার্ধ পরিষ्कार রাখুন',
            '२४ ঘণ্টার মধ্যে নতুন বর্জ্যের খবর দিন',
            'প্রতি মাসে ছবি প্রমাণ'
          ],
          hi: [
            '५० मीटर त्रिज्या को स्वच्छ रखें',
            '२४ घंटे के भीतर नया कचरा रिपोर्ट करें',
            'मासिक फोटो प्रमाण'
          ]
        }
      },
      public_record: {
        visible_fields: ['location', 'photo', 'sub_type', 'health_hazard', 'status', 'resolution_time_days', 'resolution_photo'],
        hidden_fields: ['reporter_device_id']
      },
      resolved: {
        definition_en: 'Garbage removed. Photo confirms the spot is clean.',
        definition_bn: 'বর্জ্য অপসারিত। ছবি নিশ্চিত করে স্থান পরিষ্কার।',
        definition_hi: 'कचरा हटाया गया। फोटो की पुष्टि करता है कि जगह साफ है।',
        requires_photo: true,
        requires_verifier_count: 1
      }
    },
    roads: {
      key: 'roads',
      en: 'Roads & Paths',
      bn: 'রাস্তা এবং পথ',
      hi: 'सड़कें और पथ',
      emoji: '🚗',
      photo: {
        required: true,
        hints: {
          en: [
            'Show the damage: pothole, broken edge, missing drain cover',
            'Stand back enough to see the scope',
            'Good light, no parked vehicles blocking the view'
          ],
          bn: [
            'ক্ষতি দেখান: গর্ত, ভাঙা প্রান্ত, নালার ঢাকনা নেই',
            'ক্ষতির পরিধি দেখার জন্য পিছিয়ে দাঁড়ান',
            'ভালো আলো, কোনো পার্ক করা গাড়ি নেই'
          ],
          hi: [
            'नुकसान दिखाएं: गड्ढा, टूटा किनारा, नाली का कवर नहीं',
            'नुकसान की सीमा देखने के लिए पीछे हटें',
            'अच्छी रोशनी, कोई पार्क की गई गाड़ी नहीं'
          ]
        },
        max_size_kb: 200
      },
      questions: [
        {
          key: 'road_type',
          order: 1,
          type: 'choice',
          en: 'Road type',
          bn: 'রাস্তার ধরন',
          hi: 'सड़क का प्रकार',
          options: [
            { key: 'village_road', en: 'Village road', bn: 'গ্রাম রাস্তা', hi: 'गाँव की सड़क' },
            { key: 'town_road', en: 'Town road', bn: 'শহর রাস্তা', hi: 'शहर की सड़क' },
            { key: 'nh_sh', en: 'National/State Highway', bn: 'জাতীয়/রাজ্য হাইওয়ে', hi: 'राष्ट्रीय/राज्य राजमार्ग' },
            { key: 'pmgsy', en: 'PMGSY (rural development)', bn: 'পিএমজিএসওয়াই', hi: 'पीएमजीएसवाई' }
          ]
        },
        {
          key: 'damage_type',
          order: 2,
          type: 'choice',
          en: "What's the damage?",
          bn: 'কী ক্ষতি?',
          hi: 'नुकसान क्या है?',
          options: [
            { key: 'pothole', en: 'Pothole', bn: 'গর্ত', hi: 'गड्ढा' },
            { key: 'broken_edge', en: 'Broken edge', bn: 'ভাঙা প্রান্ত', hi: 'टूटा हुआ किनारा' },
            { key: 'missing_drain', en: 'Missing drain cover', bn: 'নালার ঢাকনা নেই', hi: 'नाली का कवर नहीं' },
            { key: 'waterlogged', en: 'Waterlogged', bn: 'জলাবদ্ধ', hi: 'जलभराव' },
            { key: 'broken_footpath', en: 'Broken footpath', bn: 'ভাঙা ফুটপাথ', hi: 'टूटा हुआ फुटपाथ' }
          ]
        },
        {
          key: 'damage_length_m',
          order: 3,
          type: 'choice',
          en: 'How long is the damaged section?',
          bn: 'ক্ষতিগ্রস্ত অংশ কতটা দীর্ঘ?',
          hi: 'क्षतिग्रस्ত खंड कितना लंबा है?',
          options: [
            { key: 'less_5m', en: 'Less than 5 m', bn: '५ मीटारের कम', hi: '५ मीटर से कम' },
            { key: '5_20m', en: '5–20 m', bn: '५–२० मीटर', hi: '५–२० मीटर' },
            { key: 'more_20m', en: 'More than 20 m', bn: '२० मीटारের बेशि', hi: '२० मीटर से अधिक' }
          ]
        },
        {
          key: 'traffic_hazard',
          order: 4,
          type: 'yes_no',
          en: 'Is this a hazard to traffic?',
          bn: 'এটা যানবাহনের জন্য বিপদ?',
          hi: 'क्या यह ट्रैफिक के लिए खतरा है?'
        },
        {
          key: 'location_description',
          order: 5,
          type: 'open_text',
          max_length: 100,
          en: 'Street name or landmark',
          bn: 'রাস্তার নাম বা ল্যান্ডমার্ক',
          hi: 'सड़क का नाम या स्थलचिह्न'
        },
        {
          key: 'consent',
          order: 6,
          type: 'yes_no',
          required: true,
          en: 'Confirm: this is accurate and you agree to our terms',
          bn: 'নিশ্চিত করুন: এটি সঠিক এবং আপনি শর্তে সম্মত',
          hi: 'पुष्टि करें: यह सही है और आप शर्तों से सहमत हैं'
        }
      ],
      responsible_body: [
        {
          type: 'municipality',
          department: 'PWD / Roads & Buildings',
          sla_hours: 168,
          escalation_path: [
            { level: 1, role: 'Ward Roads Inspector', escalate_if_breached_hours: 168 },
            { level: 2, role: 'Ward Engineer', escalate_if_breached_hours: 240 },
            { level: 3, role: 'Chief Engineer', escalate_if_breached_hours: 336 }
          ]
        },
        {
          type: 'gram_panchayat',
          department: 'PMGSY / Gram Panchayat',
          sla_hours: 240,
          escalation_path: [
            { level: 1, role: 'GP Gram Vikas Mitra (road officer)', escalate_if_breached_hours: 240 },
            { level: 2, role: 'GP Pradhan', escalate_if_breached_hours: 360 },
            { level: 3, role: 'BDO', escalate_if_breached_hours: 480 }
          ]
        }
      ],
      steward: {
        eligible_types: ['shop', 'school', 'government_office', 'ngo'],
        can_adopt_radius_m: 50,
        responsibilities: {
          en: [
            'Report dangerous potholes immediately',
            'Help coordinate repairs with village volunteers'
          ],
          bn: [
            'বিপজ্জনক গর্ত অবিলম্বে রিপোর্ট করুন',
            'গ্রাম স্বেচ্ছাসেবকদের সাথে মেরামত সমন্বয় করতে সাহায্য করুন'
          ],
          hi: [
            'खतरनाक गड्ढों की तुरंत रिपोर्ट करें',
            'गाँव के स्वयंसेवकों के साथ मरम्मत में समन्वय करने में मदद करें'
          ]
        }
      },
      public_record: {
        visible_fields: ['location', 'photo', 'damage_type', 'traffic_hazard', 'status', 'resolution_time_days', 'responsible_body', 'before_after_photos'],
        hidden_fields: ['reporter_device_id']
      },
      resolved: {
        definition_en: 'Road repaired or pothole filled. Before/after photos show the repair.',
        definition_bn: 'রাস্তা মেরামত বা গর্ত পূর্ণ। আগে/পরে ছবি মেরামত দেখায়।',
        definition_hi: 'सड़क की मरम्मत या गड्ढा भरा गया। पहले/बाद की तस्वीरें मरम्मत दिखाती हैं।',
        requires_photo: true,
        requires_verifier_count: 2
      }
    },
    schools: {
      key: 'schools',
      en: 'Schools',
      bn: 'স্কুল',
      hi: 'स्कूल',
      emoji: '🏫',
      photo: {
        required: true,
        hints: {
          en: [
            'School name board visible if possible',
            'Show the specific issue: roof leak, broken window, dirty toilet, etc.',
            'Daytime photo, good light'
          ],
          bn: [
            'সম্ভব হলে স্কুলের নাম বোর্ড দৃশ্যমান',
            'নির্দিষ্ট সমস্যা দেখান: ছাদ ঝরা, ভাঙা জানালা, ময়লা টয়লেট, ইত্যাদি',
            'দিনের আলোয় ছবি, ভালো আলো'
          ],
          hi: [
            'यदि संभव हो तो स्कूल का नाम बोर्ड दिखाई दे',
            'विशिष्ट समस्या दिखाएं: छत से रिसाव, टूटी खिड़की, गंदा शौचालय, आदि',
            'दिन के समय की तस्वीर, अच्छी रोशनी'
          ]
        },
        max_size_kb: 200
      },
      questions: [
        {
          key: 'school_name',
          order: 1,
          type: 'open_text',
          max_length: 100,
          en: 'School name (or GP/Block/Town)',
          bn: 'স্কুলের নাম (বা জিপি/ব্লক/টাউন)',
          hi: 'स्कूल का नाम (या जीपी/ब्लॉक/शहर)'
        },
        {
          key: 'issue_type',
          order: 2,
          type: 'choice',
          en: "What's the issue?",
          bn: 'সমস্যা কী?',
          hi: 'मुद्दा क्या है?',
          options: [
            { key: 'roof_leak', en: 'Roof leak', bn: 'ছাদ ঝরা', hi: 'छत से रिसाव' },
            { key: 'broken_window', en: 'Broken window', bn: 'ভাঙা জানালা', hi: 'टूटी हुई खिड़की' },
            { key: 'broken_toilet', en: 'Broken toilet', bn: 'ভাঙা টয়লেট', hi: 'टूटा हुआ शौचालय' },
            { key: 'no_drinking_water', en: 'No drinking water', bn: 'পানীয় জল নেই', hi: 'पीने का पानी नहीं' },
            { key: 'furniture_missing', en: 'Furniture missing/broken', bn: 'আসবাবপত্র নেই/ভাঙা', hi: 'फर्नीचर गायब/टूटा हुआ' },
            { key: 'walls_dirty', en: 'Walls dirty/graffiti', bn: 'দেয়াল ময়লা/গ্রাফিটি', hi: 'दीवारें गंदी/ग्राफिटी' },
            { key: 'mid_day_meal_issue', en: 'Mid-day meal issue', bn: 'মধ্যাহ্ন খাবারের সমস্যা', hi: 'मध्याह्न भोजन समस्या' }
          ]
        },
        {
          key: 'severity',
          order: 3,
          type: 'choice',
          en: 'How severe is this?',
          bn: 'এটা কতটা গুরুতর?',
          hi: 'यह कितना गंभीर है?',
          options: [
            { key: 'minor', en: 'Minor (cosmetic)', bn: 'ছোটখাটো (সৌন্দর্য)', hi: 'मामूली (कॉस्मेटिक)' },
            { key: 'moderate', en: 'Moderate (affecting learning)', bn: 'মধ্যম (শিক্ষায় প্রভাব)', hi: 'मध्यम (सीखने को प्रभावित)' },
            { key: 'severe', en: 'Severe (health/safety risk)', bn: 'গুরুতর (স্বাস্থ্য/নিরাপত্তা ঝুঁকি)', hi: 'गंभीर (स्वास्थ्य/सुरक्षा जोखिम)' }
          ]
        },
        {
          key: 'students_affected',
          order: 4,
          type: 'choice',
          en: 'How many students are affected?',
          bn: 'কতজন শিক্ষার্থী প্রভাবিত?',
          hi: 'कितने छात्र प्रभावित हैं?',
          options: [
            { key: 'few', en: 'Few/isolated', bn: 'কয়েকজন/বিচ্ছিন্ন', hi: 'कुछ/अलग-थलग' },
            { key: 'several', en: 'Several classrooms', bn: 'একাধিক শ্রেণীকক্ষ', hi: 'कई कक्षाएं' },
            { key: 'whole_school', en: 'Whole school', bn: 'পুরো স্কুল', hi: 'पूरा स्कूल' }
          ]
        },
        {
          key: 'location_description',
          order: 5,
          type: 'open_text',
          max_length: 100,
          en: 'Where in the school? (classroom, toilet, kitchen, etc.)',
          bn: 'স্কুলের কোথায়? (শ্রেণীকক্ষ, টয়লেট, রসুইঘর, ইত্যাদি)',
          hi: 'स्कूल में कहाँ? (कक्षा, शौचालय, रसोई, आदि)'
        },
        {
          key: 'consent',
          order: 6,
          type: 'yes_no',
          required: true,
          en: 'Confirm: this is accurate and you agree to our terms',
          bn: 'নিশ্চিত করুন: এটি সঠিক এবং আপনি শর্তে সম্মত',
          hi: 'पुष्टि करें: यह सही है और आप शर्तों से सहमत हैं'
        }
      ],
      responsible_body: [
        {
          type: 'municipality',
          department: 'Education / Schools Directorate',
          sla_hours: 240,
          escalation_path: [
            { level: 1, role: 'School Headmaster/Principal', escalate_if_breached_hours: 240 },
            { level: 2, role: 'Municipality Education Officer', escalate_if_breached_hours: 360 },
            { level: 3, role: 'District Education Officer', escalate_if_breached_hours: 480 }
          ]
        },
        {
          type: 'gram_panchayat',
          department: 'Education / Govt. School (GP)',
          sla_hours: 360,
          escalation_path: [
            { level: 1, role: 'School Head', escalate_if_breached_hours: 360 },
            { level: 2, role: 'BDO Education Officer', escalate_if_breached_hours: 480 },
            { level: 3, role: 'District Education Officer', escalate_if_breached_hours: 600 }
          ]
        }
      ],
      steward: {
        eligible_types: ['school', 'parent_committee', 'ngo', 'cbo'],
        can_adopt_radius_m: 100,
        responsibilities: {
          en: [
            'Ensure the school is in good repair',
            'Document progress with photos each month',
            'Coordinate with officials'
          ],
          bn: [
            'স্কুলটি ভালো মেরামত করা আছে নিশ্চিত করুন',
            'প্রতি মাসে ছবি দিয়ে অগ্রগতি নথিভুক্ত করুন',
            'অফিসারদের সাথে সমন্বয় করুন'
          ],
          hi: [
            'सुनिश्चित करें कि स्कूल अच्छी स्थिति में है',
            'प्रत्येक महीने फोटो के साथ प्रगति दस्तावेज़ करें',
            'अधिकारियों के साथ समन्वय करें'
          ]
        }
      },
      public_record: {
        visible_fields: ['school_name', 'location', 'photo', 'issue_type', 'severity', 'status', 'resolution_time_days', 'before_after_photos', 'responsible_body'],
        hidden_fields: ['reporter_device_id']
      },
      resolved: {
        definition_en: 'Issue is fixed. Photo shows the school is in good condition.',
        definition_bn: 'সমস্যা সমাধান হয়েছে। ছবি দেখায় স্কুল ভালো অবস্থায়।',
        definition_hi: 'समस्या का समाधान हो गया है। तस्वीर दिखाती है कि स्कूल अच्छी स्थिति में है।',
        requires_photo: true,
        requires_verifier_count: 2
      }
    }
  }
};

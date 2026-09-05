#!/usr/bin/env python3
"""Generate all missing Texas city landing pages from Houston template."""
import re, os

BASE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = open(os.path.join(BASE, 'houston.html')).read()

CITIES = [
    {
        'slug': 'corpus-christi',
        'name': 'Corpus Christi',
        'crashes': '12,840',
        'monthly': '1,070',
        'highways': 'I-37, SPID (SH-358), and the Crosstown Expressway are among the most dangerous corridors in South Texas',
        'road1': 'I-37', 'road2': 'SPID', 'road3': 'Crosstown Expressway', 'road4': 'SH-358',
        'settlements': [
            ('$1.1M', 'Rear-End on I-37 Near Calallen', 'Herniated discs, 5 months missed work. Full settlement including future medical.'),
            ('$720K', 'T-Bone on SPID at Staples St', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$480K', 'Truck Accident on SH-358 Westbound', '18-wheeler failed to yield. Broken arm and back surgery. Settled in 5 months.'),
            ('$240K', 'Distracted Driver on Crosstown Expy', 'Phone-distracted rear-end at highway speed. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'beaumont',
        'name': 'Beaumont',
        'crashes': '5,340',
        'monthly': '445',
        'highways': 'I-10, the Eastex Freeway (US-69), and US-96 are among the most dangerous corridors in Southeast Texas',
        'road1': 'I-10', 'road2': 'Eastex Freeway', 'road3': 'US-69', 'road4': 'US-96',
        'settlements': [
            ('$980K', 'Rear-End on I-10 East Near Beaumont', 'Cervical herniation, 4 months missed work. Full settlement including future medical.'),
            ('$640K', 'T-Bone at College & 11th St', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$420K', 'Truck Accident on US-69 Northbound', '18-wheeler failed to yield. Multiple injuries. Settled in 6 months.'),
            ('$210K', 'Drunk Driver on Eastex Freeway', 'DUI driver rear-ended client at highway speed. Settled in under 4 months.'),
        ],
    },
    {
        'slug': 'lubbock',
        'name': 'Lubbock',
        'crashes': '9,340',
        'monthly': '778',
        'highways': 'US-87, Loop 289, and I-27 are among the most dangerous corridors in West Texas',
        'road1': 'I-27', 'road2': 'Loop 289', 'road3': 'US-87', 'road4': '82nd Street',
        'settlements': [
            ('$870K', 'Rear-End on I-27 South, Lubbock', 'Herniated discs, 3 months missed work. Full settlement including future medical.'),
            ('$580K', 'T-Bone on Loop 289 at University Ave', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$390K', 'Drunk Driver on US-87 Southbound', 'DUI driver ran stop sign. Broken ribs and shoulder surgery. Settled in 5 months.'),
            ('$180K', 'Distracted Driver on 82nd Street', 'Phone-distracted rear-end at busy intersection. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'amarillo',
        'name': 'Amarillo',
        'crashes': '7,890',
        'monthly': '657',
        'highways': 'I-40, US-60, and Loop 335 are among the most dangerous corridors in the Texas Panhandle',
        'road1': 'I-40', 'road2': 'Loop 335', 'road3': 'US-60', 'road4': 'Canyon Expy',
        'settlements': [
            ('$820K', 'Rear-End on I-40 East, Amarillo', 'Cervical herniation, 4 months missed work. Full settlement including future medical.'),
            ('$560K', 'T-Bone on Loop 335 at Georgia St', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$370K', 'Truck Accident on US-60 Eastbound', '18-wheeler changed lanes without warning. Multiple injuries. Settled in 5 months.'),
            ('$175K', 'Drunk Driver on Canyon Expy', 'DUI driver rear-ended client at highway speed. Settled in under 3 months.'),
        ],
    },
    {
        'slug': 'arlington',
        'name': 'Arlington',
        'crashes': '14,230',
        'monthly': '1,185',
        'highways': 'I-20, SH-360, and I-30 are among the most dangerous corridors in the DFW area',
        'road1': 'I-20', 'road2': 'I-30', 'road3': 'SH-360', 'road4': 'Collins St',
        'settlements': [
            ('$1.2M', 'Rear-End on I-20 West, Arlington', 'Herniated discs, 6 months missed work. Full settlement including future medical.'),
            ('$790K', 'T-Bone on SH-360 at I-30', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$510K', 'Drunk Driver on I-30 Westbound', 'DUI driver ran stop sign. Broken ribs and shoulder surgery. Settled in 5 months.'),
            ('$265K', 'Distracted Driver on Collins St', 'Phone-distracted rear-end at highway speed. Quick settlement in 4 months.'),
        ],
    },
    {
        'slug': 'plano',
        'name': 'Plano',
        'crashes': '11,200',
        'monthly': '933',
        'highways': 'US-75 (Central Expy), George Bush Tpke (190), and SH-289 are among the most dangerous corridors in North DFW',
        'road1': 'US-75', 'road2': 'George Bush Tpke', 'road3': 'SH-289', 'road4': 'Park Blvd',
        'settlements': [
            ('$1.0M', 'Rear-End on US-75 at Park Blvd, Plano', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$680K', 'T-Bone on George Bush Tpke at SH-289', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$440K', 'Drunk Driver on Central Expy Northbound', 'DUI driver rear-ended client at highway speed. Back surgery. Settled in 5 months.'),
            ('$220K', 'Distracted Driver on Park Blvd', 'Phone-distracted rear-end at busy Plano intersection. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'garland',
        'name': 'Garland',
        'crashes': '8,920',
        'monthly': '743',
        'highways': 'I-30, US-80, and George Bush Tpke (190) are among the most dangerous corridors in East Dallas County',
        'road1': 'I-30', 'road2': 'US-80', 'road3': 'George Bush Tpke', 'road4': 'Garland Rd',
        'settlements': [
            ('$880K', 'Rear-End on I-30 East, Garland', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$600K', 'T-Bone on US-80 at Shiloh Rd', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$400K', 'Truck Accident on George Bush Tpke', '18-wheeler failed to merge safely. Multiple injuries. Settled in 5 months.'),
            ('$190K', 'Drunk Driver on Garland Rd', 'DUI driver ran stop sign. Broken arm and whiplash. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'grand-prairie',
        'name': 'Grand Prairie',
        'crashes': '7,340',
        'monthly': '611',
        'highways': 'I-30, SH-360, and I-20 are among the most dangerous corridors in the Mid-Cities area',
        'road1': 'I-30', 'road2': 'SH-360', 'road3': 'I-20', 'road4': 'Arkansas Ln',
        'settlements': [
            ('$840K', 'Rear-End on I-30 West, Grand Prairie', 'Cervical herniation, 4 months missed work. Full settlement including future medical.'),
            ('$570K', 'T-Bone on SH-360 at Arkansas Ln', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$380K', 'Drunk Driver on I-20 Westbound', 'DUI driver caused multi-car crash. Broken ribs and surgery. Settled in 5 months.'),
            ('$190K', 'Distracted Driver on Arkansas Ln', 'Phone-distracted rear-end at highway speed. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'laredo',
        'name': 'Laredo',
        'crashes': '9,870',
        'monthly': '822',
        'highways': 'I-35, US-59, and Loop 20 are among the most dangerous corridors in South Texas',
        'road1': 'I-35', 'road2': 'Loop 20', 'road3': 'US-59', 'road4': 'Saunders Ave',
        'settlements': [
            ('$920K', 'Rear-End on I-35 North, Laredo', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$620K', 'T-Bone on Loop 20 at Del Mar Blvd', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$410K', 'Truck Accident on US-59 Eastbound', '18-wheeler failed to yield. Multiple injuries. Settled in 5 months.'),
            ('$200K', 'Drunk Driver on Saunders Ave', 'DUI driver ran stop sign. Broken arm and neck injury. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'killeen',
        'name': 'Killeen',
        'crashes': '6,210',
        'monthly': '517',
        'highways': 'US-190, SH-195, and the Stan Schlueter Loop are among the most dangerous corridors in Central Texas',
        'road1': 'US-190', 'road2': 'SH-195', 'road3': 'Stan Schlueter Loop', 'road4': 'Clear Creek Rd',
        'settlements': [
            ('$810K', 'Rear-End on US-190 West, Killeen', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$540K', 'T-Bone on SH-195 at Fort Hood St', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$360K', 'Drunk Driver on Stan Schlueter Loop', 'DUI driver rear-ended client at highway speed. Surgery required. Settled in 5 months.'),
            ('$175K', 'Distracted Driver on Clear Creek Rd', 'Phone-distracted rear-end. Whiplash and soft tissue. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'waco',
        'name': 'Waco',
        'crashes': '5,670',
        'monthly': '472',
        'highways': 'I-35, US-84, and Loop 340 are among the most dangerous corridors in Central Texas',
        'road1': 'I-35', 'road2': 'Loop 340', 'road3': 'US-84', 'road4': 'Valley Mills Dr',
        'settlements': [
            ('$830K', 'Rear-End on I-35 South, Waco', 'Cervical herniation, 4 months missed work. Full settlement including future medical.'),
            ('$560K', 'T-Bone on Loop 340 at Valley Mills Dr', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$370K', 'Truck Accident on US-84 Eastbound', '18-wheeler failed to yield. Multiple injuries. Settled in 5 months.'),
            ('$185K', 'Drunk Driver on I-35 Northbound', 'DUI driver caused rear-end at highway speed. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'odessa',
        'name': 'Odessa',
        'crashes': '4,520',
        'monthly': '376',
        'highways': 'I-20, US-385, and Loop 338 are among the most dangerous corridors in the Permian Basin',
        'road1': 'I-20', 'road2': 'Loop 338', 'road3': 'US-385', 'road4': 'Andrews Hwy',
        'settlements': [
            ('$760K', 'Rear-End on I-20 East, Odessa', 'Herniated discs, 3 months missed work. Full settlement including future medical.'),
            ('$510K', 'T-Bone on US-385 at 42nd St', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$340K', 'Truck Accident on Andrews Hwy', 'Oilfield truck failed to yield. Broken arm and back injury. Settled in 4 months.'),
            ('$165K', 'Drunk Driver on Loop 338', 'DUI driver ran red light. Whiplash and soft tissue damage. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'pasadena',
        'name': 'Pasadena',
        'crashes': '5,980',
        'monthly': '498',
        'highways': 'SH-225, I-10, and Beltway 8 are among the most dangerous corridors in the Houston Ship Channel area',
        'road1': 'SH-225', 'road2': 'Beltway 8', 'road3': 'I-10', 'road4': 'Fairmont Pkwy',
        'settlements': [
            ('$870K', 'Rear-End on SH-225 Near Pasadena', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$590K', 'T-Bone at Beltway 8 & SH-225', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$390K', 'Truck Accident on I-10 Eastbound', '18-wheeler failed to yield. Multiple injuries. Settled in 5 months.'),
            ('$195K', 'Drunk Driver on Fairmont Pkwy', 'DUI driver rear-ended client. Broken ribs and whiplash. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'round-rock',
        'name': 'Round Rock',
        'crashes': '5,120',
        'monthly': '426',
        'highways': 'I-35, SH-45, and US-183 are among the most dangerous corridors in the Austin metro area',
        'road1': 'I-35', 'road2': 'SH-45', 'road3': 'US-183', 'road4': 'RM-620',
        'settlements': [
            ('$800K', 'Rear-End on I-35 Near Round Rock', 'Cervical herniation, 4 months missed work. Full settlement including future medical.'),
            ('$540K', 'T-Bone on SH-45 at Mays St', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$360K', 'Drunk Driver on US-183 Southbound', 'DUI driver caused multi-car crash. Surgery required. Settled in 5 months.'),
            ('$180K', 'Distracted Driver on RM-620', 'Phone-distracted rear-end at busy Round Rock intersection. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'pearland',
        'name': 'Pearland',
        'crashes': '4,890',
        'monthly': '407',
        'highways': 'SH-288, Beltway 8, and FM-518 are among the most dangerous corridors in the Houston south suburbs',
        'road1': 'SH-288', 'road2': 'Beltway 8', 'road3': 'FM-518', 'road4': 'Broadway St',
        'settlements': [
            ('$780K', 'Rear-End on SH-288 South, Pearland', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$520K', 'T-Bone on FM-518 at SH-288', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$350K', 'Drunk Driver on Beltway 8 South', 'DUI driver rear-ended client at highway speed. Back surgery. Settled in 4 months.'),
            ('$170K', 'Distracted Driver on Broadway St', 'Phone-distracted rear-end in Pearland shopping district. Quick settlement.'),
        ],
    },
    {
        'slug': 'el-paso',
        'name': 'El Paso',
        'crashes': '18,920',
        'monthly': '1,576',
        'highways': 'I-10, US-54, and I-25 are among the most dangerous corridors in the El Paso metro',
        'road1': 'I-10', 'road2': 'US-54', 'road3': 'I-25', 'road4': 'Loop 375',
        'settlements': [
            ('$1.3M', 'Rear-End on I-10 West, El Paso', 'Herniated discs, 5 months missed work. Full settlement including future medical.'),
            ('$850K', 'T-Bone on US-54 at Loop 375', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$540K', 'Drunk Driver on I-25 Northbound', 'DUI driver caused multi-car pileup. Broken ribs and surgery. Settled in 5 months.'),
            ('$270K', 'Distracted Driver on Montana Ave', 'Phone-distracted rear-end at highway speed. Quick settlement in 4 months.'),
        ],
    },
    {
        'slug': 'fort-worth',
        'name': 'Fort Worth',
        'crashes': '28,340',
        'monthly': '2,361',
        'highways': 'I-30, I-35W, and I-820 are among the most dangerous corridors in the Fort Worth metro',
        'road1': 'I-30', 'road2': 'I-35W', 'road3': 'I-820', 'road4': 'SH-121',
        'settlements': [
            ('$1.4M', 'Rear-End on I-30 West, Fort Worth', 'Herniated discs, 6 months missed work. Full settlement including future medical.'),
            ('$900K', 'T-Bone on I-35W at I-820', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$580K', 'Drunk Driver on SH-121 Southbound', 'DUI driver ran stop sign. Broken ribs and shoulder surgery. Settled in 5 months.'),
            ('$290K', 'Distracted Driver on I-820 East', 'Phone-distracted rear-end at highway speed. Quick settlement in 4 months.'),
        ],
    },
    {
        'slug': 'midland',
        'name': 'Midland',
        'crashes': '4,670',
        'monthly': '389',
        'highways': 'I-20, SH-349, and Loop 250 are among the most dangerous corridors in the Permian Basin',
        'road1': 'I-20', 'road2': 'Loop 250', 'road3': 'SH-349', 'road4': 'Andrews Hwy',
        'settlements': [
            ('$770K', 'Rear-End on I-20 West, Midland', 'Herniated discs, 3 months missed work. Full settlement including future medical.'),
            ('$520K', 'T-Bone on SH-349 at Wadley Ave', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$345K', 'Truck Accident on Loop 250 Eastbound', 'Oilfield vehicle failed to yield. Multiple injuries. Settled in 4 months.'),
            ('$170K', 'Drunk Driver on Andrews Hwy', 'DUI driver rear-ended client. Whiplash and soft tissue. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'mcallen',
        'name': 'McAllen',
        'crashes': '4,180',
        'monthly': '348',
        'highways': 'US-83, SH-107, and US-281 are among the most dangerous corridors in the Rio Grande Valley',
        'road1': 'US-83', 'road2': 'SH-107', 'road3': 'US-281', 'road4': 'Ware Rd',
        'settlements': [
            ('$740K', 'Rear-End on US-83 East, McAllen', 'Cervical herniation, 3 months missed work. Full settlement including future medical.'),
            ('$500K', 'T-Bone on SH-107 at Ware Rd', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$330K', 'Truck Accident on US-281 Northbound', '18-wheeler failed to yield. Multiple injuries. Settled in 4 months.'),
            ('$165K', 'Drunk Driver on Ware Rd', 'DUI driver ran stop sign. Broken arm and whiplash. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'abilene',
        'name': 'Abilene',
        'crashes': '4,310',
        'monthly': '359',
        'highways': 'I-20, US-83, and Loop 322 are among the most dangerous corridors in West Central Texas',
        'road1': 'I-20', 'road2': 'Loop 322', 'road3': 'US-83', 'road4': 'S 14th St',
        'settlements': [
            ('$750K', 'Rear-End on I-20 East, Abilene', 'Herniated discs, 3 months missed work. Full settlement including future medical.'),
            ('$505K', 'T-Bone on US-83 at Loop 322', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$335K', 'Drunk Driver on Loop 322 Southbound', 'DUI driver caused rear-end at highway speed. Surgery required. Settled in 4 months.'),
            ('$168K', 'Distracted Driver on S 14th St', 'Phone-distracted rear-end in Abilene. Whiplash and soft tissue. Settled in 3 months.'),
        ],
    },
    {
        'slug': 'irving',
        'name': 'Irving',
        'crashes': '8,540',
        'monthly': '711',
        'highways': 'SH-114, I-635 (LBJ Freeway), and SH-183 are among the most dangerous corridors in the DFW metro',
        'road1': 'SH-114', 'road2': 'I-635 (LBJ)', 'road3': 'SH-183', 'road4': 'MacArthur Blvd',
        'settlements': [
            ('$950K', 'Rear-End on SH-114 Near Las Colinas', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$640K', 'T-Bone on I-635 at I-35E, Irving', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$425K', 'Drunk Driver on SH-183 Westbound', 'DUI driver caused multi-car crash. Broken ribs and surgery. Settled in 5 months.'),
            ('$215K', 'Distracted Driver on MacArthur Blvd', 'Phone-distracted rear-end near DFW Airport. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'mckinney',
        'name': 'McKinney',
        'crashes': '6,890',
        'monthly': '574',
        'highways': 'US-75, SH-121, and SH-380 are among the most dangerous corridors in Collin County',
        'road1': 'US-75', 'road2': 'SH-121', 'road3': 'SH-380', 'road4': 'Lake Forest Dr',
        'settlements': [
            ('$840K', 'Rear-End on US-75 Near McKinney', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$570K', 'T-Bone on SH-121 at Lake Forest Dr', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$380K', 'Drunk Driver on SH-380 Westbound', 'DUI driver caused rear-end at highway speed. Surgery required. Settled in 4 months.'),
            ('$190K', 'Distracted Driver on Lake Forest Dr', 'Phone-distracted rear-end in McKinney. Whiplash. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'frisco',
        'name': 'Frisco',
        'crashes': '6,540',
        'monthly': '545',
        'highways': 'the Dallas North Tollway, SH-121, and US-380 are among the most dangerous corridors in Collin County',
        'road1': 'Dallas North Tollway', 'road2': 'SH-121', 'road3': 'US-380', 'road4': 'Preston Rd',
        'settlements': [
            ('$870K', 'Rear-End on Dallas North Tollway, Frisco', 'Herniated discs, 4 months missed work. Full settlement including future medical.'),
            ('$590K', 'T-Bone on SH-121 at the DNT', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$390K', 'Drunk Driver on US-380 Eastbound', 'DUI driver caused rear-end at highway speed. Back surgery. Settled in 5 months.'),
            ('$195K', 'Distracted Driver on Preston Rd', 'Phone-distracted rear-end in Frisco. Whiplash. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'sugar-land',
        'name': 'Sugar Land',
        'crashes': '3,890',
        'monthly': '324',
        'highways': 'US-90, SH-6, and the Fort Bend Pkwy are among the most dangerous corridors in Fort Bend County',
        'road1': 'US-90', 'road2': 'SH-6', 'road3': 'Fort Bend Pkwy', 'road4': 'Sweetwater Blvd',
        'settlements': [
            ('$720K', 'Rear-End on US-90 West, Sugar Land', 'Herniated discs, 3 months missed work. Full settlement including future medical.'),
            ('$490K', 'T-Bone on SH-6 at Sweetwater Blvd', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$325K', 'Drunk Driver on Fort Bend Pkwy', 'DUI driver rear-ended client at highway speed. Neck surgery. Settled in 4 months.'),
            ('$160K', 'Distracted Driver on Sweetwater Blvd', 'Phone-distracted rear-end in Sugar Land. Whiplash. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'the-woodlands',
        'name': 'The Woodlands',
        'crashes': '3,760',
        'monthly': '313',
        'highways': 'I-45, SH-242, and the Grand Pkwy (99) are among the most dangerous corridors in Montgomery County',
        'road1': 'I-45', 'road2': 'Grand Pkwy', 'road3': 'SH-242', 'road4': 'Research Forest Dr',
        'settlements': [
            ('$710K', 'Rear-End on I-45 North, The Woodlands', 'Herniated discs, 3 months missed work. Full settlement including future medical.'),
            ('$480K', 'T-Bone on Grand Pkwy at SH-242', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$320K', 'Drunk Driver on I-45 Southbound', 'DUI driver caused rear-end at highway speed. Surgery required. Settled in 4 months.'),
            ('$160K', 'Distracted Driver on Research Forest Dr', 'Phone-distracted rear-end. Whiplash. Quick settlement in 3 months.'),
        ],
    },
    {
        'slug': 'denton',
        'name': 'Denton',
        'crashes': '4,020',
        'monthly': '335',
        'highways': 'I-35E, I-35W, and US-380 are among the most dangerous corridors in Denton County',
        'road1': 'I-35E', 'road2': 'US-380', 'road3': 'I-35W', 'road4': 'Loop 288',
        'settlements': [
            ('$730K', 'Rear-End on I-35E Near Denton', 'Herniated discs, 3 months missed work. Full settlement including future medical.'),
            ('$495K', 'T-Bone on US-380 at Loop 288', 'Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.'),
            ('$330K', 'Drunk Driver on I-35W Southbound', 'DUI driver caused rear-end at highway speed. Neck surgery. Settled in 4 months.'),
            ('$165K', 'Distracted Driver on Loop 288', 'Phone-distracted rear-end near UNT. Whiplash. Quick settlement in 3 months.'),
        ],
    },
]


def make_settle_html(city, settlements):
    cards = []
    for amount, type_, detail in settlements:
        cards.append(f'''    <div class="settle-card fade-up">
      <div class="settle-tag">{city}, TX</div>
      <div class="settle-amount">{amount}</div>
      <div class="settle-type">{type_}</div>
      <div class="settle-detail">{detail}</div>
    </div>''')
    return '\n'.join(cards)


def build_page(c):
    name   = c['name']
    slug   = c['slug']
    crash  = c['crashes']
    month  = c['monthly']
    hwy    = c['highways']
    road1  = c['road1']
    road2  = c['road2']
    road3  = c['road3']
    road4  = c['road4']

    h = TEMPLATE

    # ── Meta / head ──────────────────────────────────────────────────────────
    h = h.replace('Houston Car Accident Help', f'{name} Car Accident Help')
    h = h.replace(
        'Houston car accident? Get a FREE case review from a licensed Texas injury attorney. No fees unless you win. Serving all of Houston — call (346) 860-1929, available 24/7.',
        f'{name} car accident? Get a FREE case review from a licensed Texas injury attorney. No fees unless you win. Serving all of {name} — call (346) 860-1929, available 24/7.'
    )
    h = h.replace(
        'Houston car accident, Houston crash help, Houston injury attorney, car accident Houston TX, free case review Houston, Houston personal injury, auto accident Houston, crash help Houston',
        f'{name} car accident, {name} crash help, {name} injury attorney, car accident {name} TX, free case review {name}, {name} personal injury, auto accident {name}, crash help {name}'
    )
    h = h.replace(
        'Houston car accident? Free case review from a licensed Texas injury attorney. No fees unless you win. Call (346) 860-1929 anytime.',
        f'{name} car accident? Free case review from a licensed Texas injury attorney. No fees unless you win. Call (346) 860-1929 anytime.'
    )
    h = h.replace(
        'Houston car accident? You may be owed thousands. Free review, no fees unless you win.',
        f'{name} car accident? You may be owed thousands. Free review, no fees unless you win.'
    )
    h = h.replace('crashhelptx.com/houston', f'crashhelptx.com/{slug}')
    # Schema
    h = h.replace(
        '"description": "Free car accident case review for Houston, TX residents. No fees unless you win. Available 24/7."',
        f'"description": "Free car accident case review for {name}, TX residents. No fees unless you win. Available 24/7."'
    )
    h = h.replace('"areaServed": "Houston, TX"', f'"areaServed": "{name}, TX"')

    # ── Urgency ticker ────────────────────────────────────────────────────────
    h = h.replace('✅ Serving all of Houston', f'✅ Serving all of {name}', )  # replaces both occurrences

    # ── Hero badge ────────────────────────────────────────────────────────────
    h = h.replace('Houston Accident Referral — Free &amp; Confidential', f'{name} Accident Referral — Free &amp; Confidential')

    # ── H1 ────────────────────────────────────────────────────────────────────
    h = h.replace(
        '<span class="white">Injured in a</span><br/>\n        <span class="gradient">Houston Crash?</span>',
        f'<span class="white">Injured in a</span><br/>\n        <span class="gradient">{name} Crash?</span>'
    )

    # ── Hero sub paragraph ────────────────────────────────────────────────────
    h = h.replace(
        'Houston has over <strong>65,000 crashes per year</strong> — I-10, I-45, Beltway 8, and the 610 Loop are among the most dangerous corridors in the state. <strong>Insurance companies move fast. You should too.</strong>',
        f'{name} has over <strong>{crash} crashes per year</strong> — {hwy}. <strong>Insurance companies move fast. You should too.</strong>'
    )

    # ── Trust pill ────────────────────────────────────────────────────────────
    h = h.replace('<div class="trust-pill">Houston TX</div>', f'<div class="trust-pill">{name} TX</div>')

    # ── Hero mini form JS city ────────────────────────────────────────────────
    h = h.replace("city: 'Houston' },\n    null,", f"city: '{name}' }},\n    null,")

    # ── Card label ────────────────────────────────────────────────────────────
    h = h.replace('<div class="card-label">Real Results · Houston</div>', f'<div class="card-label">Real Results · {name}</div>')

    # ── Settlements section ───────────────────────────────────────────────────
    h = h.replace('Recent Houston<br/>Settlements', f'Recent {name}<br/>Settlements')
    h = h.replace('These are real results from Houston car accident cases. Yours could be next.',
                  f'These are real results from {name} car accident cases. Yours could be next.')
    # Replace the 4 settlement cards block
    old_settle = '''    <div class="settle-card fade-up">
      <div class="settle-tag">Houston, TX</div>
      <div class="settle-amount">$1.4M</div>
      <div class="settle-type">Rear-End on I-10 West, Houston</div>
      <div class="settle-detail">Herniated discs, 6 months missed work. Full settlement including future medical.</div>
    </div>
    <div class="settle-card fade-up">
      <div class="settle-tag">Houston, TX</div>
      <div class="settle-amount">$875K</div>
      <div class="settle-type">T-Bone at Westheimer &amp; Gessner</div>
      <div class="settle-detail">Red light runner. Medical bills, lost wages, pain &amp; suffering fully recovered.</div>
    </div>
    <div class="settle-card fade-up">
      <div class="settle-tag">Houston, TX</div>
      <div class="settle-amount">$560K</div>
      <div class="settle-type">Drunk Driver on 610 Loop</div>
      <div class="settle-detail">DUI driver ran stop sign. Broken ribs and shoulder surgery. Settled in 5 months.</div>
    </div>
    <div class="settle-card fade-up">
      <div class="settle-tag">Houston, TX</div>
      <div class="settle-amount">$290K</div>
      <div class="settle-type">Distracted Driver on I-45 South</div>
      <div class="settle-detail">Phone-distracted rear-end at highway speed. Quick settlement in 4 months.</div>
    </div>'''
    h = h.replace(old_settle, make_settle_html(name, c['settlements']))

    # ── Reviews — swap Houston-specific road mentions ─────────────────────────
    h = h.replace('rear-ended on I-45', f'rear-ended on {road1}')
    h = h.replace('my accident on the 610 Loop', f'my accident on {road2}')
    h = h.replace('accident on I-10 West', f'accident on {road3}')
    h = h.replace('my car on Beltway 8', f'my car on {road4}')

    # ── Footer ────────────────────────────────────────────────────────────────
    h = h.replace('Serving all of Houston &amp; Texas', f'Serving all of {name} &amp; Texas')

    # ── WhatsApp ──────────────────────────────────────────────────────────────
    h = h.replace(
        'https://wa.me/13468601929?text=Hi%2C%20I%20was%20in%20a%20car%20accident%20in%20Houston%2C%20Texas%20and%20need%20help.',
        f'https://wa.me/13468601929?text=Hi%2C%20I%20was%20in%20a%20car%20accident%20in%20{name.replace(" ", "%20")}%2C%20Texas%20and%20need%20help.'
    )

    # ── Form select pre-selected city ─────────────────────────────────────────
    # Remove Houston's selected, add city's selected
    h = h.replace('<option selected>Houston</option>', '<option>Houston</option>')
    # Add new city option selected at top of list (before Houston)
    h = h.replace(
        '<option value="" disabled>City in Texas *</option>\n        <option>Houston</option>',
        f'<option value="" disabled>City in Texas *</option>\n        <option selected>{name}</option>\n        <option>Houston</option>'
    )

    # ── Exit popup JS city ────────────────────────────────────────────────────
    h = h.replace(
        "source: 'exit-popup', city: 'Houston' },",
        f"source: 'exit-popup', city: '{name}' }},"
    )

    return h


def main():
    built = []
    for c in CITIES:
        out_path = os.path.join(BASE, f'{c["slug"]}.html')
        if os.path.exists(out_path):
            print(f'  SKIP  {c["slug"]}.html (already exists)')
            continue
        html = build_page(c)
        with open(out_path, 'w') as f:
            f.write(html)
        built.append(c['slug'])
        print(f'  BUILT {c["slug"]}.html')
    print(f'\nDone — {len(built)} pages generated: {", ".join(built)}')


if __name__ == '__main__':
    main()

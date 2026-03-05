import type { Dish } from './types';

export const DISHES: Dish[] = [
  {
    id: 'dish-1',
    title: 'Grandma Chicken Curry',
    category: 'Dinner',
    price: 14.5,
    availability: 'in_stock',
    description: 'Slow-cooked chicken curry with house spice blend.',
  },
  {
    id: 'dish-2',
    title: 'Village Veg Biryani',
    category: 'Lunch',
    price: 11,
    availability: 'in_stock',
    description: 'Fragrant basmati rice biryani with seasonal vegetables.',
  },
  {
    id: 'dish-3',
    title: 'Stuffed Paratha Platter',
    category: 'Breakfast',
    price: 8.5,
    availability: 'limited',
    description: 'Two stuffed parathas with yogurt and pickle.',
  },
  {
    id: 'dish-4',
    title: 'Kesar Kheer Cup',
    category: 'Dessert',
    price: 5,
    availability: 'in_stock',
    description: 'Creamy saffron rice pudding with pistachio.',
  },
  {
    id: 'dish-5',
    title: 'Paneer Tikka Bowl',
    category: 'Dinner',
    price: 12,
    availability: 'sold_out',
    description: 'Charred paneer tikka with mint yogurt drizzle.',
  },
];

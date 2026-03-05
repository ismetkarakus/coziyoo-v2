export type Dish = {
  id: string;
  title: string;
  category: 'Breakfast' | 'Lunch' | 'Dinner' | 'Dessert';
  price: number;
  availability: 'in_stock' | 'limited' | 'sold_out';
  description: string;
};

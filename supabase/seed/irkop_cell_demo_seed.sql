-- DEVELOPMENT/STAGING ONLY. Replace owner UUID with an existing auth.users UUID.
do $$ declare owner_id uuid := '00000000-0000-0000-0000-000000000001'; b uuid := gen_random_uuid(); o uuid := gen_random_uuid(); c uuid; p uuid; t uuid; i int; methods text[] := array['cash','transfer','cash_tunai','credit']; begin
insert into public.irkop_cell_businesses(id,owner_user_id,name) values(b,owner_id,'IRKOP Cell Demo');
insert into public.irkop_cell_outlets(id,business_id,name,address) values(o,b,'Outlet Utama','Semarang');
for i in 1..30 loop insert into public.irkop_cell_products(business_id,name,category,sku,sell_price,stock) values(b,'Produk Demo '||i,case when i%3=0 then 'Aksesoris' when i%3=1 then 'Pulsa' else 'Service' end,'SKU-'||lpad(i::text,4,'0'),(25000+random()*475000)::numeric(14,2),(5+random()*95)::numeric(14,2)); end loop;
for i in 1..20 loop insert into public.irkop_cell_customers(business_id,name,phone) values(b,'Pelanggan Demo '||i,'0812'||lpad((1000000+i)::text,7,'0')); end loop;
for i in 1..150 loop
select id into c from public.irkop_cell_customers where business_id=b order by random() limit 1;
insert into public.irkop_cell_transactions(business_id,outlet_id,customer_id,transaction_no,payment_method,status,total,transaction_at) values(b,o,c,'DEMO-'||i,methods[1+floor(random()*4)::int],'completed',(50000+random()*950000)::numeric(14,2),now()-((150-i)||' hours')::interval) returning id,total into t;
select id into p from public.irkop_cell_products where business_id=b order by random() limit 1;
insert into public.irkop_cell_transaction_items(transaction_id,product_id,product_name,qty,unit_price,subtotal) select t,id,name,1,sell_price,sell_price from public.irkop_cell_products where id=p;
insert into public.irkop_cell_cash_mutations(business_id,outlet_id,transaction_id,mutation_type,amount,description) select b,o,t,'in',total,'Random demo transaction' from public.irkop_cell_transactions where id=t;
end loop; end $$;

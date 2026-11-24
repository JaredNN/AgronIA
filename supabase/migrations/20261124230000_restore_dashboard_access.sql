ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_metrics ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fields ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.map_elements ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.field_metrics ALTER COLUMN user_id SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "Users can view own fields and admins all" ON public.fields;
DROP POLICY IF EXISTS "Users can create own fields and admins any" ON public.fields;
DROP POLICY IF EXISTS "Users can update own fields and admins any" ON public.fields;
DROP POLICY IF EXISTS "Users can delete own fields and admins any" ON public.fields;

CREATE POLICY "Users can view own fields and admins all"
  ON public.fields FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()));
CREATE POLICY "Users can create own fields and admins any"
  ON public.fields FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()));
CREATE POLICY "Users can update own fields and admins any"
  ON public.fields FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
  WITH CHECK (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()));
CREATE POLICY "Users can delete own fields and admins any"
  ON public.fields FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()));

DROP POLICY IF EXISTS "Users can access own map elements" ON public.map_elements;
CREATE POLICY "Users can access own map elements"
  ON public.map_elements FOR ALL TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
    AND EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_id AND (f.user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
    )
  )
  WITH CHECK (
    (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
    AND EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_id AND (f.user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
    )
  );

DROP POLICY IF EXISTS "Users can access own field metrics" ON public.field_metrics;
CREATE POLICY "Users can access own field metrics"
  ON public.field_metrics FOR ALL TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
    AND EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_id AND (f.user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
    )
  )
  WITH CHECK (
    (user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
    AND EXISTS (
      SELECT 1 FROM public.fields f
      WHERE f.id = field_id AND (f.user_id = (SELECT auth.uid()) OR (SELECT public.is_agronia_admin()))
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.map_elements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_metrics TO authenticated;

REVOKE ALL ON FUNCTION public.save_map_workspace(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_map_workspace(text, jsonb) TO authenticated;
